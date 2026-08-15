use serde_json::{json, Map, Value};

pub const TOKEN_STATS: &str = "token_stats";
pub const USAGE_RECORDS: &str = "usage_records";
pub const QUOTA_INTELLIGENCE: &str = "quota_intelligence";
pub const ADVANCED_SYNC: &str = "advanced_sync";

pub const FEATURE_KEYS: [&str; 4] = [
    TOKEN_STATS,
    USAGE_RECORDS,
    QUOTA_INTELLIGENCE,
    ADVANCED_SYNC,
];

/// Flags for a fresh install: minimal mode by default.
pub fn defaults_minimal() -> Value {
    flags_with(false)
}

/// Flags used when migrating a pre-feature-flag profile: keep everything visible.
pub fn defaults_full() -> Value {
    flags_with(true)
}

fn flags_with(enabled: bool) -> Value {
    let mut object = Map::new();
    for key in FEATURE_KEYS {
        object.insert(key.to_string(), json!(enabled));
    }
    Value::Object(object)
}

pub fn is_enabled(settings: &Value, key: &str) -> bool {
    settings
        .get("feature_flags")
        .and_then(|flags| flags.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// Fills a partial `feature_flags` object. Missing keys inherit `fallback_enabled`,
/// which is false for a fresh install and true for a legacy profile.
pub fn ensure_flags(settings: &mut Value, fallback_enabled: bool) {
    if settings.get("feature_flags").and_then(Value::as_object).is_none() {
        settings["feature_flags"] = if fallback_enabled { defaults_full() } else { defaults_minimal() };
        return;
    }
    for key in FEATURE_KEYS {
        if settings["feature_flags"].get(key).is_none() {
            settings["feature_flags"][key] = json!(fallback_enabled);
        }
    }
    // Drop retired groups that may still exist in older persisted payloads.
    if let Some(flags) = settings["feature_flags"].as_object_mut() {
        flags.retain(|key, _| FEATURE_KEYS.contains(&key.as_str()));
    }
}

/// Validates a `PUT /config` patch so a disabled feature cannot be re-enabled
/// with a non-boolean value, and unknown top-level keys never corrupt the shape.
pub fn validate_patch(patch: &Value) -> Result<(), String> {
    if let Some(flags) = patch.get("feature_flags") {
        let object = flags
            .as_object()
            .ok_or_else(|| "feature_flags must be an object".to_string())?;
        for key in FEATURE_KEYS {
            if let Some(value) = object.get(key) {
                if !value.is_boolean() {
                    return Err(format!("feature flag {key} must be a boolean"));
                }
            }
        }
    }
    if let Some(value) = patch.get("feature_legacy_prompt_pending") {
        if !value.is_boolean() {
            return Err("feature_legacy_prompt_pending must be a boolean".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_install_is_minimal() {
        let mut settings = json!({});
        ensure_flags(&mut settings, false);
        assert!(!is_enabled(&settings, TOKEN_STATS));
        assert!(!is_enabled(&settings, ADVANCED_SYNC));
    }

    #[test]
    fn legacy_profile_is_full_and_partial_flags_are_filled() {
        let mut settings = json!({});
        ensure_flags(&mut settings, true);
        for key in FEATURE_KEYS {
            assert!(is_enabled(&settings, key));
        }
        settings["feature_flags"][TOKEN_STATS] = json!(false);
        ensure_flags(&mut settings, true);
        assert!(!is_enabled(&settings, TOKEN_STATS));
        assert!(is_enabled(&settings, USAGE_RECORDS));
    }

    #[test]
    fn validates_flag_patches() {
        assert!(validate_patch(&json!({"feature_flags": {"token_stats": true}})).is_ok());
        assert!(validate_patch(&json!({"feature_flags": {"token_stats": "yes"}})).is_err());
        assert!(validate_patch(&json!({"feature_legacy_prompt_pending": 1})).is_err());
    }

    #[test]
    fn drops_retired_flag_groups() {
        let mut settings = json!({"feature_flags": {"data_tools": true}});
        ensure_flags(&mut settings, false);
        assert!(settings["feature_flags"].get("data_tools").is_none());
        for key in FEATURE_KEYS {
            assert_eq!(settings["feature_flags"][key], json!(false));
        }
    }
}
