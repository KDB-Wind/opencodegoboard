use reqwest::{redirect::Policy, Client, RequestBuilder, StatusCode};
use std::time::Duration;

pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/148.0";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_ATTEMPTS: usize = 3;

pub fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| error.to_string())
}

/// Sends one GET request built by `build` and returns its status and body.
/// Connection-level failures (send errors, dropped bodies) are retried up to
/// MAX_ATTEMPTS total attempts with a short backoff; HTTP error statuses are
/// returned to the caller immediately so callers can keep their own messages.
pub async fn get_text_with_retries<F>(mut build: F) -> Result<(StatusCode, String), String>
where
    F: FnMut() -> RequestBuilder,
{
    let mut last_error = "request failed".to_string();
    for attempt in 0..MAX_ATTEMPTS {
        let request = build();
        match request.send().await {
            Ok(response) => {
                let status = response.status();
                match response.text().await {
                    Ok(text) => return Ok((status, text)),
                    Err(error) => {
                        last_error = error.to_string();
                        if attempt + 1 < MAX_ATTEMPTS {
                            tokio::time::sleep(Duration::from_millis(400 * (1 << attempt))).await;
                        }
                    }
                }
            }
            Err(error) => {
                last_error = error.to_string();
                if attempt + 1 < MAX_ATTEMPTS {
                    tokio::time::sleep(Duration::from_millis(400 * (1 << attempt))).await;
                }
            }
        }
    }
    Err(last_error)
}
