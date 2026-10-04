#[cfg(target_os = "android")]
use tauri::{Manager, State};

#[cfg(target_os = "windows")]
mod microsoft_store;

#[cfg(target_os = "android")]
const MAX_LOCAL_BOOK_BYTES: usize = 250 * 1024 * 1024;
#[cfg(target_os = "android")]
struct AndroidLocalLibrary(tauri::plugin::PluginHandle<tauri::Wry>);
#[cfg(target_os = "android")]
struct NativeBookFiles(std::path::PathBuf);

#[cfg(target_os = "android")]
#[tauri::command]
async fn native_list_books(
    auth: State<'_, AndroidLocalLibrary>,
) -> Result<serde_json::Value, String> {
    auth.0
        .run_mobile_plugin_async("nativeListBooks", ())
        .await
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn native_save_book(
    record: serde_json::Value,
    auth: State<'_, AndroidLocalLibrary>,
) -> Result<(), String> {
    auth.0
        .run_mobile_plugin_async::<serde_json::Value>(
            "nativeSaveBook",
            serde_json::json!({"record": record.to_string()}),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn native_delete_book(
    id: String,
    auth: State<'_, AndroidLocalLibrary>,
) -> Result<(), String> {
    auth.0
        .run_mobile_plugin_async::<serde_json::Value>(
            "nativeDeleteBook",
            serde_json::json!({"id": id}),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn native_tts_voices(
    native: State<'_, AndroidLocalLibrary>,
) -> Result<serde_json::Value, String> {
    native
        .0
        .run_mobile_plugin_async("nativeTtsVoices", ())
        .await
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn native_tts_speak(
    text: String,
    voice_uri: String,
    language: String,
    rate: f32,
    native: State<'_, AndroidLocalLibrary>,
) -> Result<serde_json::Value, String> {
    if text.trim().is_empty() || text.chars().count() > 4_000 {
        return Err("TTS_INVALID_TEXT".into());
    }
    if !(0.5..=2.0).contains(&rate) {
        return Err("TTS_INVALID_RATE".into());
    }
    native
        .0
        .run_mobile_plugin_async(
            "nativeTtsSpeak",
            serde_json::json!({
                "text": text,
                "voiceUri": voice_uri,
                "language": language,
                "rate": rate
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
async fn native_tts_control(
    command: &'static str,
    native: State<'_, AndroidLocalLibrary>,
) -> Result<(), String> {
    native
        .0
        .run_mobile_plugin_async::<serde_json::Value>(command, ())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn native_tts_pause(native: State<'_, AndroidLocalLibrary>) -> Result<(), String> {
    native_tts_control("nativeTtsPause", native).await
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn native_tts_resume(native: State<'_, AndroidLocalLibrary>) -> Result<(), String> {
    native_tts_control("nativeTtsResume", native).await
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn native_tts_stop(native: State<'_, AndroidLocalLibrary>) -> Result<(), String> {
    native_tts_control("nativeTtsStop", native).await
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn system_font_families() -> Vec<String> {
    use std::collections::BTreeSet;
    let mut families = BTreeSet::new();
    for key in [
        r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
        r"HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
    ] {
        let Ok(output) = std::process::Command::new("reg.exe")
            .args(["query", key])
            .output()
        else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let Some((name, _)) = line
                .split_once("REG_SZ")
                .or_else(|| line.split_once("REG_EXPAND_SZ"))
            else {
                continue;
            };
            let family = name.trim().split('(').next().unwrap_or("").trim();
            if !family.is_empty()
                && family.len() <= 90
                && family
                    .chars()
                    .all(|c| c.is_alphanumeric() || " .-".contains(c))
            {
                families.insert(family.to_owned());
            }
        }
    }
    families.into_iter().collect()
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
#[tauri::command]
fn system_font_families() -> Vec<String> {
    Vec::new()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "windows")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        restart_app,
        system_font_families,
        microsoft_store::microsoft_store_products,
        microsoft_store::microsoft_store_purchase,
        microsoft_store::microsoft_store_customer_purchase_id
    ]);
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    let builder =
        builder.invoke_handler(tauri::generate_handler![restart_app, system_font_families]);
    #[cfg(target_os = "android")]
    let builder = builder
        .invoke_handler(tauri::generate_handler![
            restart_app,
            native_list_books,
            native_save_book,
            native_delete_book,
            native_tts_voices,
            native_tts_speak,
            native_tts_pause,
            native_tts_resume,
            native_tts_stop
        ])
        .setup(|app| {
            // Keep the existing directory to preserve already-imported books.
            app.manage(NativeBookFiles(
                app.path()
                    .app_data_dir()?
                    .join("files/drive-library/objects"),
            ));
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("book-file", |context, request, responder| {
            let root = context.app_handle().state::<NativeBookFiles>().0.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let decoded =
                    percent_encoding::percent_decode_str(request.uri().path()).decode_utf8_lossy();
                let path = decoded.trim_start_matches('/');
                let parts: Vec<_> = path.split('/').collect();
                let valid = parts.len() == 3
                    && parts[..2].iter().all(|part| {
                        !part.is_empty()
                            && part.len() <= 80
                            && part.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                    })
                    && matches!(parts[2], "data.bin" | "cover.bin");
                let file = root.join(path);
                let bounded = valid
                    && std::fs::metadata(&file)
                        .is_ok_and(|m| m.is_file() && m.len() <= MAX_LOCAL_BOOK_BYTES as u64);
                let bytes = if bounded {
                    std::fs::read(file).ok()
                } else {
                    None
                };
                let response = match bytes {
                    Some(bytes) if bytes.len() <= MAX_LOCAL_BOOK_BYTES => {
                        let mime = if bytes.starts_with(b"\x89PNG") {
                            "image/png"
                        } else if bytes.starts_with(b"\xff\xd8\xff") {
                            "image/jpeg"
                        } else {
                            "application/octet-stream"
                        };
                        tauri::http::Response::builder()
                            .status(200)
                            .header("Content-Type", mime)
                            .header("Access-Control-Allow-Origin", "*")
                            .body(bytes)
                            .unwrap()
                    }
                    _ => tauri::http::Response::builder()
                        .status(404)
                        .body(Vec::new())
                        .unwrap(),
                };
                responder.respond(response);
            });
        })
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("local-library")
                .setup(|app, api| {
                    let handle = api
                        .register_android_plugin("app.autumnreader.reader", "LocalLibraryPlugin")?;
                    app.manage(AndroidLocalLibrary(handle));
                    Ok(())
                })
                .build(),
        );
    builder
        .run(tauri::generate_context!())
        .expect("Could not start Autumn Reader");
}
