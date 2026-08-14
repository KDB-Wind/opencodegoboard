const SERVICE:&str="OpenCodeGoBoard";

pub fn set(account_id:&str,value:&str)->Result<(),String>{keyring::Entry::new(SERVICE,account_id).map_err(|e|e.to_string())?.set_password(value).map_err(|e|e.to_string())}
pub fn get(account_id:&str)->Result<String,String>{keyring::Entry::new(SERVICE,account_id).map_err(|e|e.to_string())?.get_password().map_err(|e|e.to_string())}
pub fn remove(account_id:&str){if let Ok(entry)=keyring::Entry::new(SERVICE,account_id){let _=entry.delete_credential();}}
