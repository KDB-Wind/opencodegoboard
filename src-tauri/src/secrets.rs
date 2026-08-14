const SERVICE:&str="OpenCodeGoBoard";
use base64::{engine::general_purpose::STANDARD as BASE64,Engine};

pub fn set(account_id:&str,value:&str)->Result<(),String>{keyring::Entry::new(SERVICE,account_id).map_err(|e|e.to_string())?.set_password(value).map_err(|e|e.to_string())}
pub fn get(account_id:&str)->Result<String,String>{keyring::Entry::new(SERVICE,account_id).map_err(|e|e.to_string())?.get_password().map_err(|e|e.to_string())}
pub fn remove(account_id:&str){if let Ok(entry)=keyring::Entry::new(SERVICE,account_id){let _=entry.delete_credential();}}

#[cfg(windows)]
pub fn decrypt_electron(stored:&str)->Result<String,String>{
  use windows::Win32::{Foundation::{LocalFree,HLOCAL},Security::Cryptography::{CryptUnprotectData,CRYPT_INTEGER_BLOB}};
  let mut bytes=BASE64.decode(stored.strip_prefix("enc:").ok_or("not an Electron encrypted value")?).map_err(|e|e.to_string())?;
  let input=CRYPT_INTEGER_BLOB{cbData:bytes.len() as u32,pbData:bytes.as_mut_ptr()};let mut output=CRYPT_INTEGER_BLOB::default();
  unsafe{CryptUnprotectData(&input,None,None,None,None,1,&mut output).map_err(|e|e.to_string())?;let result=std::slice::from_raw_parts(output.pbData,output.cbData as usize).to_vec();let _=LocalFree(Some(HLOCAL(output.pbData.cast())));String::from_utf8(result).map_err(|e|e.to_string())}
}

#[cfg(not(windows))]
pub fn decrypt_electron(_stored:&str)->Result<String,String>{Err("Electron credential migration is only available on Windows".into())}
