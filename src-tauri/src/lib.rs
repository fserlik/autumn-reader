use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::State;
use url::Url;

const DRIVE_SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";
const BACKUP_NAME: &str = "autumn-reader-backup.zip";
const MAX_BACKUP_BYTES: usize = 250 * 1024 * 1024;

struct DriveSession(Mutex<Option<(String, Instant)>>);

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
}

#[derive(Deserialize)]
struct FileList {
    files: Vec<DriveBackup>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DriveBackup {
    id: String,
    name: String,
    modified_time: String,
    size: Option<String>,
}

fn random_url_safe() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn drive_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())
}

fn receive_authorization(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                let mut buffer = [0u8; 8192];
                let count = stream.read(&mut buffer).map_err(|e| e.to_string())?;
                let request = String::from_utf8_lossy(&buffer[..count]);
                let path = request
                    .split_whitespace()
                    .nth(1)
                    .ok_or("Respuesta OAuth inválida")?;
                let callback = Url::parse(&format!("http://127.0.0.1{path}"))
                    .map_err(|_| "Respuesta OAuth inválida")?;
                let parameters: std::collections::HashMap<_, _> =
                    callback.query_pairs().into_owned().collect();
                let valid_state = parameters
                    .get("state")
                    .is_some_and(|state| state == expected_state);
                let code = if valid_state {
                    parameters.get("code").cloned()
                } else {
                    None
                };
                let html = if code.is_some() {
                    "<h1>Autumn Reader conectado</h1><p>Ya puedes cerrar esta pestaña y volver a la aplicación.</p>"
                } else {
                    "<h1>No se pudo conectar</h1><p>Vuelve a Autumn Reader e inténtalo de nuevo.</p>"
                };
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}", html.len());
                let _ = stream.write_all(response.as_bytes());
                if !valid_state {
                    return Err("La respuesta de Google no coincide con esta solicitud".into());
                }
                if let Some(code) = code {
                    return Ok(code);
                }
                return Err(format!(
                    "Google no autorizó la conexión: {}",
                    parameters
                        .get("error")
                        .map(String::as_str)
                        .unwrap_or("sin código")
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Se agotó el tiempo para conectar con Google".into())
}

#[tauri::command]
async fn drive_connect(client_id: String, session: State<'_, DriveSession>) -> Result<String, String> {
    if !client_id.ends_with(".apps.googleusercontent.com") || client_id.len() > 300 {
        return Err("Introduce un Client ID de Google OAuth para aplicación de escritorio".into());
    }
    let client_secret = option_env!("AUTUMN_GOOGLE_CLIENT_SECRET")
        .ok_or("Falta configurar Google OAuth para esta versión de Autumn Reader")?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let verifier = random_url_safe();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_url_safe();
    let mut auth_url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", DRIVE_SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state);
    webbrowser::open(auth_url.as_str())
        .map_err(|e| format!("No se pudo abrir el navegador: {e}"))?;
    let code =
        tauri::async_runtime::spawn_blocking(move || receive_authorization(listener, &state))
            .await
            .map_err(|e| e.to_string())??;
    let client = drive_client()?;
    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret),
            ("code", code.as_str()),
            ("code_verifier", verifier.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let details: serde_json::Value = response.json().await.unwrap_or_default();
        let code = details
            .get("error")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("error desconocido");
        let description = details
            .get("error_description")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        return Err(format!(
            "Google rechazó la conexión ({status}): {code}. {description}"
        ));
    }
    let token: TokenResponse = response.json().await.map_err(|e| e.to_string())?;
    let expires = Instant::now() + Duration::from_secs(token.expires_in.saturating_sub(60));
    *session.0.lock().map_err(|e| e.to_string())? = Some((token.access_token.clone(), expires));
    Ok(token.access_token)
}

fn access_token(session: &DriveSession) -> Result<String, String> {
    let guard = session.0.lock().map_err(|e| e.to_string())?;
    match guard.as_ref() {
        Some((token, expires)) if Instant::now() < *expires => Ok(token.clone()),
        _ => Err("La conexión con Drive venció. Vuelve a conectar tu cuenta".into()),
    }
}

#[tauri::command]
async fn drive_list_backups(session: State<'_, DriveSession>) -> Result<Vec<DriveBackup>, String> {
    let token = access_token(&session)?;
    let response = drive_client()?
        .get("https://www.googleapis.com/drive/v3/files")
        .bearer_auth(token)
        .query(&[
            ("spaces", "appDataFolder"),
            ("q", "name = 'autumn-reader-backup.zip' and trashed = false"),
            ("fields", "files(id,name,modifiedTime,size)"),
            ("orderBy", "modifiedTime desc"),
            ("pageSize", "100"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Drive no pudo listar las copias ({})",
            response.status()
        ));
    }
    let list: FileList = response.json().await.map_err(|e| e.to_string())?;
    Ok(list.files)
}

#[tauri::command]
async fn drive_save_backup(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.to_vec(),
        tauri::ipc::InvokeBody::Json(value) => {
            let Some(values) = value.as_array() else {
                return Err("La copia recibida no tiene un formato válido".into());
            };
            if values.is_empty() || values.len() > MAX_BACKUP_BYTES {
                return Err("La copia debe ocupar menos de 250 MB".into());
            }
            values
                .iter()
                .map(|value| {
                    value
                        .as_u64()
                        .filter(|byte| *byte <= u8::MAX as u64)
                        .map(|byte| byte as u8)
                        .ok_or_else(|| "La copia contiene datos no válidos".to_string())
                })
                .collect::<Result<Vec<_>, _>>()?
        }
    };
    if bytes.is_empty() || bytes.len() > MAX_BACKUP_BYTES {
        return Err("La copia debe ocupar menos de 250 MB".into());
    }
    let bytes = bytes.to_vec();
    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
        .ok_or("La sesión de Drive venció. Vuelve a conectar tu cuenta")?
        .to_string();
    let client = drive_client()?;
    let metadata = serde_json::json!({ "name": BACKUP_NAME, "parents": ["appDataFolder"], "mimeType": "application/zip" });
    let response = client
        .post("https://www.googleapis.com/upload/drive/v3/files")
        .query(&[("uploadType", "resumable")])
        .bearer_auth(&token)
        .header(header::CONTENT_TYPE, "application/json; charset=UTF-8")
        .header("X-Upload-Content-Type", "application/zip")
        .header("X-Upload-Content-Length", bytes.len().to_string())
        .json(&metadata)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Drive no pudo iniciar la copia ({})",
            response.status()
        ));
    }
    let location = response
        .headers()
        .get(header::LOCATION)
        .ok_or("Drive no devolvió una dirección de subida")?
        .to_str()
        .map_err(|e| e.to_string())?
        .to_string();
    if !location.starts_with("https://www.googleapis.com/upload/drive/v3/files?") {
        return Err("Drive devolvió una dirección de subida inesperada".into());
    }
    let response = client
        .put(location)
        .header(header::CONTENT_LENGTH, bytes.len())
        .body(bytes.clone())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Drive no pudo guardar la copia ({})",
            response.status()
        ));
    }
    Ok(())
}

#[tauri::command]
async fn drive_download_backup(
    file_id: String,
    session: State<'_, DriveSession>,
) -> Result<tauri::ipc::Response, String> {
    if file_id.is_empty()
        || !file_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Identificador de copia inválido".into());
    }
    let token = access_token(&session)?;
    let response = drive_client()?
        .get(format!(
            "https://www.googleapis.com/drive/v3/files/{file_id}"
        ))
        .query(&[("alt", "media")])
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Drive no pudo descargar la copia ({})",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_BACKUP_BYTES)
    {
        return Err("La copia supera los 250 MB admitidos".into());
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BACKUP_BYTES {
        return Err("La copia supera los 250 MB admitidos".into());
    }
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DriveSession(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            drive_connect,
            drive_list_backups,
            drive_save_backup,
            drive_download_backup
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar Autumn Reader");
}
