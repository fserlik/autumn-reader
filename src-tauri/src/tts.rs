use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use bzip2::read::BzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sherpa_onnx::{
    GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKokoroModelConfig,
    OfflineTtsModelConfig, OfflineTtsVitsModelConfig,
};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::State;

const CATALOG_JSON: &str = include_str!("../../src/services/tts/catalog-data.json");
const MAX_TEXT_CHARS: usize = 2_400;
const MAX_IMPORT_ARCHIVE_BYTES: u64 = 1_500_000_000;
const MAX_IMPORT_EXPANDED_BYTES: u64 = 4_000_000_000;
const MAX_IMPORT_ENTRIES: u64 = 50_000;
const KOKORO_STYLE_ROWS: u64 = 510;
const KOKORO_STYLE_COLUMNS: u64 = 256;
const KOKORO_VOICE_BYTES: u64 = KOKORO_STYLE_ROWS * KOKORO_STYLE_COLUMNS * 4;
const IMPORT_VALIDATION_TEXT: &str = "Every story has its season.";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(test), allow(dead_code))]
struct CatalogPackage {
    id: String,
    engine: String,
    size: u64,
    sha256: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogVoice {
    id: String,
    package_id: String,
    engine: String,
    locale: String,
    speaker_id: i32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedVoice {
    id: String,
    package_id: String,
    engine: String,
    name: String,
    locale: String,
    region: String,
    speaker_id: i32,
    quality: String,
    imported: bool,
    archive_sha256: String,
    #[serde(default)]
    storage_bytes: u64,
    #[serde(default)]
    model_version: Option<String>,
    #[serde(default)]
    model_package_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportedManifest {
    schema_version: u32,
    package_id: String,
    engine: String,
    archive_sha256: String,
    archive_bytes: u64,
    #[serde(default)]
    voice: Option<ImportedVoice>,
    installed_at: u64,
    imported: bool,
    #[serde(default)]
    model_version: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndividualVoiceManifest {
    schema_version: u32,
    voice: ImportedVoice,
    voice_file: String,
    voice_sha256: String,
    installed_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceImportRequest {
    source_path: String,
    engine: Option<String>,
    name: Option<String>,
    locale: Option<String>,
    speaker_id: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceImportInspection {
    kind: &'static str,
    engine: &'static str,
    format: &'static str,
    name: Option<String>,
    locale: Option<String>,
    model_version: Option<String>,
    base_model_installed: bool,
    requires_name: bool,
    requires_locale: bool,
    size: u64,
}

#[derive(Deserialize)]
struct Catalog {
    packages: Vec<CatalogPackage>,
    voices: Vec<CatalogVoice>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsRuntimeStatus {
    available: bool,
    version: String,
    platform: String,
    architecture: String,
    supports_piper: bool,
    supports_kokoro: bool,
    memory_mb: Option<u64>,
}

#[cfg(target_os = "windows")]
fn physical_memory_mb() -> Option<u64> {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    unsafe { GlobalMemoryStatusEx(&mut status) }
        .ok()
        .map(|_| status.ullTotalPhys / 1024 / 1024)
}

#[cfg(not(target_os = "windows"))]
fn physical_memory_mb() -> Option<u64> {
    fs::read_to_string("/proc/meminfo")
        .ok()?
        .lines()
        .find_map(|line| {
            let kib = line
                .strip_prefix("MemTotal:")?
                .split_whitespace()
                .next()?
                .parse::<u64>()
                .ok()?;
            Some(kib / 1024)
        })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPackage {
    package_id: String,
    installed: bool,
    corrupt: bool,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthesizedAudio {
    data_base64: String,
    mime_type: &'static str,
    duration_ms: u64,
}

struct CachedEngine {
    key: String,
    engine: Arc<OfflineTts>,
}

pub struct TtsManager {
    root: PathBuf,
    cached: Mutex<Option<CachedEngine>>,
    synthesis_generation: Arc<AtomicU64>,
}

impl TtsManager {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|error| error.to_string())?;
        cleanup_incomplete(&root);
        if let Some(app_data) = root.parent() {
            cleanup_import_archives(app_data);
        }
        Ok(Self {
            root,
            cached: Mutex::new(None),
            synthesis_generation: Arc::new(AtomicU64::new(1)),
        })
    }
}

fn cleanup_import_archives(app_data: &Path) {
    let Ok(entries) = fs::read_dir(app_data) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if (name.starts_with("tts-import-") || name.contains("-tts-import-"))
            && entry.path().is_file()
        {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn catalog() -> Result<Catalog, String> {
    serde_json::from_str(CATALOG_JSON).map_err(|error| format!("TTS_CATALOG_INVALID:{error}"))
}

fn cleanup_incomplete(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".partial")
            || name.ends_with(".installing")
            || name.ends_with(".importing")
        {
            let path = entry.path();
            if path.is_dir() {
                let _ = fs::remove_dir_all(path);
            } else {
                let _ = fs::remove_file(path);
            }
        }
    }
    let voice_root = root.join("voices");
    if let Ok(entries) = fs::read_dir(voice_root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.ends_with(".importing") && entry.path().is_file() {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

fn package_dir(root: &Path, id: &str) -> PathBuf {
    root.join(id)
}

fn find_file(root: &Path, predicate: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let entries = fs::read_dir(directory).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if predicate(&path) {
                return Some(path);
            }
        }
    }
    None
}

fn model_root(root: &Path) -> Option<PathBuf> {
    find_file(root, |path| {
        path.file_name().is_some_and(|name| name == "tokens.txt")
    })
    .and_then(|path| path.parent().map(Path::to_path_buf))
}

fn model_layout_valid(directory: &Path, engine: &str) -> bool {
    let Some(model_root) = model_root(&directory) else {
        return false;
    };
    let onnx = find_file(&model_root, |path| {
        path.extension().is_some_and(|ext| ext == "onnx")
    });
    let data = model_root.join("espeak-ng-data");
    let common = onnx.is_some() && data.is_dir();
    common && (engine != "kokoro" || model_root.join("voices.bin").is_file())
}

fn kokoro_model_version(directory: &Path) -> Option<String> {
    let root = model_root(directory)?;
    let bytes = fs::metadata(root.join("voices.bin")).ok()?.len();
    match bytes / KOKORO_VOICE_BYTES {
        54 if bytes % KOKORO_VOICE_BYTES == 0 => Some("kokoro-1.0".into()),
        103 if bytes % KOKORO_VOICE_BYTES == 0 => Some("kokoro-1.1".into()),
        count if count > 0 && bytes % KOKORO_VOICE_BYTES == 0 => {
            Some(format!("kokoro-{count}-speaker"))
        }
        _ => None,
    }
}

fn package_valid(root: &Path, package: &CatalogPackage) -> bool {
    let directory = package_dir(root, &package.id);
    directory.join("manifest.json").is_file() && model_layout_valid(&directory, &package.engine)
}

fn imported_manifests(root: &Path) -> Vec<(PathBuf, ImportedManifest)> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let directory = entry.path();
            if !directory.is_dir() {
                return None;
            }
            let bytes = fs::read(directory.join("manifest.json")).ok()?;
            let manifest = serde_json::from_slice::<ImportedManifest>(&bytes).ok()?;
            manifest.imported.then_some((directory, manifest))
        })
        .collect()
}

fn individual_voice_root(root: &Path) -> PathBuf {
    root.join("voices")
}

fn individual_voice_manifests(root: &Path) -> Vec<(PathBuf, IndividualVoiceManifest)> {
    let directory = individual_voice_root(root);
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().is_none_or(|extension| extension != "json") {
                return None;
            }
            let bytes = fs::read(&path).ok()?;
            let manifest = serde_json::from_slice::<IndividualVoiceManifest>(&bytes).ok()?;
            let voice_file = path.parent()?.join(&manifest.voice_file);
            (voice_file.is_file() && fs::metadata(voice_file).ok()?.len() == KOKORO_VOICE_BYTES)
                .then_some((path, manifest))
        })
        .collect()
}

fn custom_voices_path(root: &Path, package_id: &str) -> PathBuf {
    individual_voice_root(root).join(format!("{package_id}-voices.bin"))
}

fn rebuild_custom_voices(
    root: &Path,
    package: &CatalogPackage,
    extra: Option<(i32, &Path)>,
    destination: &Path,
) -> Result<(), String> {
    let base_root = model_root(&package_dir(root, &package.id)).ok_or("TTS_MODEL_CORRUPT")?;
    let mut combined = fs::read(base_root.join("voices.bin"))
        .map_err(|error| format!("TTS_MODEL_CORRUPT:{error}"))?;
    if combined.is_empty() || combined.len() as u64 % KOKORO_VOICE_BYTES != 0 {
        return Err("TTS_MODEL_CORRUPT".into());
    }
    let mut replacements: Vec<(i32, PathBuf)> = individual_voice_manifests(root)
        .into_iter()
        .filter(|(_, manifest)| manifest.voice.package_id == package.id)
        .map(|(manifest_path, manifest)| {
            (
                manifest.voice.speaker_id,
                manifest_path
                    .parent()
                    .unwrap_or(root)
                    .join(manifest.voice_file),
            )
        })
        .collect();
    if let Some((slot, path)) = extra {
        replacements.push((slot, path.to_path_buf()));
    }
    for (slot, path) in replacements {
        let bytes = fs::read(path).map_err(|error| format!("TTS_IMPORT_READ_FAILED:{error}"))?;
        if bytes.len() as u64 != KOKORO_VOICE_BYTES || slot < 0 {
            return Err("TTS_IMPORT_VOICE_INVALID".into());
        }
        let start = slot as usize * KOKORO_VOICE_BYTES as usize;
        let end = start.saturating_add(KOKORO_VOICE_BYTES as usize);
        if end > combined.len() {
            return Err("TTS_IMPORT_VOICE_LIMIT".into());
        }
        combined[start..end].copy_from_slice(&bytes);
    }
    fs::write(destination, combined).map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))
}

fn imported_package(manifest: &ImportedManifest) -> CatalogPackage {
    CatalogPackage {
        id: manifest.package_id.clone(),
        engine: manifest.engine.clone(),
        size: manifest.archive_bytes,
        sha256: manifest.archive_sha256.clone(),
    }
}

fn imported_catalog_voice(manifest: &ImportedManifest) -> CatalogVoice {
    let voice = manifest.voice.as_ref().expect("voice manifest");
    CatalogVoice {
        id: voice.id.clone(),
        package_id: manifest.package_id.clone(),
        engine: manifest.engine.clone(),
        locale: voice.locale.clone(),
        speaker_id: voice.speaker_id,
    }
}

fn package_by_id(root: &Path, id: &str) -> Option<CatalogPackage> {
    if let Ok(catalog) = catalog() {
        if let Some(package) = catalog
            .packages
            .into_iter()
            .find(|package| package.id == id)
        {
            return Some(package);
        }
    }
    imported_manifests(root)
        .into_iter()
        .find_map(|(_, manifest)| (manifest.package_id == id).then(|| imported_package(&manifest)))
}

#[tauri::command]
pub fn local_tts_runtime_status() -> TtsRuntimeStatus {
    TtsRuntimeStatus {
        available: true,
        version: sherpa_onnx::version().to_string(),
        platform: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        supports_piper: true,
        supports_kokoro: true,
        memory_mb: physical_memory_mb(),
    }
}

#[tauri::command]
pub fn local_tts_installed(state: State<'_, TtsManager>) -> Result<Vec<InstalledPackage>, String> {
    cleanup_incomplete(&state.root);
    let catalog = catalog()?;
    let mut installed: Vec<InstalledPackage> = catalog
        .packages
        .iter()
        .map(|package| {
            let directory = package_dir(&state.root, &package.id);
            let present = directory.exists();
            InstalledPackage {
                package_id: package.id.clone(),
                installed: present && package_valid(&state.root, package),
                corrupt: present && !package_valid(&state.root, package),
                bytes: directory_size(&directory),
            }
        })
        .collect();
    installed.extend(
        imported_manifests(&state.root)
            .into_iter()
            .map(|(directory, manifest)| {
                let valid = model_layout_valid(&directory, &manifest.engine);
                InstalledPackage {
                    package_id: manifest.package_id,
                    installed: valid,
                    corrupt: !valid,
                    bytes: directory_size(&directory),
                }
            }),
    );
    Ok(installed)
}

#[tauri::command]
pub fn local_tts_imported_voices(
    state: State<'_, TtsManager>,
) -> Result<Vec<ImportedVoice>, String> {
    cleanup_incomplete(&state.root);
    let mut voices: Vec<ImportedVoice> = imported_manifests(&state.root)
        .into_iter()
        .filter_map(|(_, manifest)| manifest.voice)
        .collect();
    voices.extend(
        individual_voice_manifests(&state.root)
            .into_iter()
            .map(|(_, manifest)| manifest.voice),
    );
    Ok(voices)
}

fn directory_size(root: &Path) -> u64 {
    if !root.exists() {
        return 0;
    }
    let mut total = 0;
    let mut pending = vec![root.to_path_buf()];
    while let Some(path) = pending.pop() {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    pending.push(path);
                } else if let Ok(metadata) = path.metadata() {
                    total += metadata.len();
                }
            }
        }
    }
    total
}

fn validate_name(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 80 || value.chars().any(char::is_control) {
        return Err("TTS_IMPORT_NAME_INVALID".into());
    }
    Ok(value.to_string())
}

fn validate_locale(value: &str) -> Result<String, String> {
    let value = value.trim().replace('_', "-");
    let parts: Vec<_> = value.split('-').collect();
    if value.len() > 35
        || parts.is_empty()
        || parts.iter().any(|part| {
            part.is_empty()
                || part.len() > 8
                || !part
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
        })
        || !(2..=3).contains(&parts[0].len())
    {
        return Err("TTS_IMPORT_LOCALE_INVALID".into());
    }
    Ok(value)
}

fn kokoro_voice_metadata(path: &Path) -> (Option<String>, Option<String>) {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut parts = stem.split('_');
    let prefix = parts.next().unwrap_or_default();
    let name = parts
        .next()
        .and_then(|value| value.split("-tts-import-").next())
        .filter(|value| !value.is_empty())
        .map(|value| {
            let mut characters = value.chars();
            characters
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + characters.as_str())
                .unwrap_or_default()
        });
    let locale = match prefix {
        "af" | "am" => Some("en-US".to_string()),
        "bf" | "bm" => Some("en-GB".to_string()),
        _ => None,
    };
    (name, locale)
}

fn validate_kokoro_voice_file(path: &Path) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|error| format!("TTS_IMPORT_READ_FAILED:{error}"))?;
    if bytes.len() as u64 != KOKORO_VOICE_BYTES {
        return Err("TTS_IMPORT_VOICE_INVALID:size".into());
    }
    for chunk in bytes.chunks_exact(4) {
        if !f32::from_le_bytes(chunk.try_into().expect("four bytes")).is_finite() {
            return Err("TTS_IMPORT_VOICE_INVALID:data".into());
        }
    }
    Ok(())
}

fn compatible_kokoro_base(root: &Path, version: &str) -> Option<(CatalogPackage, PathBuf)> {
    let catalog = catalog().ok()?;
    for package in catalog
        .packages
        .into_iter()
        .filter(|package| package.engine == "kokoro")
    {
        let directory = package_dir(root, &package.id);
        if package_valid(root, &package)
            && kokoro_model_version(&directory).as_deref() == Some(version)
        {
            return Some((package, directory));
        }
    }
    for (directory, manifest) in imported_manifests(root) {
        let installed_version = manifest
            .model_version
            .clone()
            .or_else(|| kokoro_model_version(&directory));
        if manifest.engine == "kokoro"
            && model_layout_valid(&directory, "kokoro")
            && installed_version.as_deref() == Some(version)
        {
            return Some((imported_package(&manifest), directory));
        }
    }
    None
}

fn hash_file(path: &Path) -> Result<(String, u64), String> {
    let mut file = File::open(path).map_err(|error| format!("TTS_IMPORT_READ_FAILED:{error}"))?;
    let mut digest = Sha256::new();
    let mut total = 0u64;
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("TTS_IMPORT_READ_FAILED:{error}"))?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        digest.update(&buffer[..read]);
    }
    Ok((format!("{:x}", digest.finalize()), total))
}

fn validated_import_source(root: &Path, source_path: &str) -> Result<PathBuf, String> {
    let source =
        fs::canonicalize(source_path).map_err(|error| format!("TTS_IMPORT_READ_FAILED:{error}"))?;
    let allowed_root = root
        .parent()
        .and_then(|path| fs::canonicalize(path).ok())
        .ok_or_else(|| "TTS_IMPORT_PATH_INVALID".to_string())?;
    if !source.starts_with(&allowed_root) || source.starts_with(root) {
        return Err("TTS_IMPORT_PATH_INVALID".into());
    }
    let metadata = source
        .metadata()
        .map_err(|error| format!("TTS_IMPORT_READ_FAILED:{error}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_IMPORT_ARCHIVE_BYTES {
        return Err("TTS_IMPORT_ARCHIVE_INVALID:size".into());
    }
    Ok(source)
}

fn archive_metadata(path: &Path) -> (Option<String>, Option<String>) {
    let raw = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim_end_matches(".tar.bz2")
        .trim_end_matches(".tbz2");
    let label = raw.split("-tts-import-").next().unwrap_or(raw);
    let pieces: Vec<_> = label
        .split(['-', '_'])
        .filter(|piece| !piece.is_empty())
        .collect();
    let locale = pieces.windows(2).find_map(|pair| {
        (pair[0].len() == 2
            && pair[1].len() == 2
            && pair.iter().all(|part| {
                part.chars()
                    .all(|character| character.is_ascii_alphabetic())
            }))
        .then(|| {
            format!(
                "{}-{}",
                pair[0].to_ascii_lowercase(),
                pair[1].to_ascii_uppercase()
            )
        })
    });
    let name = pieces
        .iter()
        .rev()
        .find(|piece| {
            !matches!(
                piece.to_ascii_lowercase().as_str(),
                "int8"
                    | "low"
                    | "medium"
                    | "high"
                    | "x"
                    | "vits"
                    | "piper"
                    | "kokoro"
                    | "lang"
                    | "multi"
            ) && !piece.chars().all(|character| character.is_ascii_digit())
        })
        .map(|piece| piece.replace(['-', '_'], " "));
    (name, locale)
}

fn inspect_import_blocking(root: &Path, source: &Path) -> Result<VoiceImportInspection, String> {
    let size = source
        .metadata()
        .map_err(|error| format!("TTS_IMPORT_READ_FAILED:{error}"))?
        .len();
    if size == KOKORO_VOICE_BYTES {
        validate_kokoro_voice_file(source)?;
        let (name, locale) = kokoro_voice_metadata(source);
        return Ok(VoiceImportInspection {
            kind: "kokoro-voice",
            engine: "kokoro",
            format: "Kokoro voice (.bin)",
            name: name.clone(),
            locale: locale.clone(),
            model_version: Some("kokoro-1.0".into()),
            base_model_installed: compatible_kokoro_base(root, "kokoro-1.0").is_some(),
            requires_name: name.is_none(),
            requires_locale: locale.is_none(),
            size,
        });
    }
    let stage = root.join(format!("inspect-{}.importing", std::process::id()));
    if stage.exists() {
        let _ = fs::remove_dir_all(&stage);
    }
    let result = (|| {
        extract_import_archive(source, &stage)?;
        let root_dir = model_root(&stage).ok_or_else(|| "TTS_IMPORT_MODEL_INVALID".to_string())?;
        let engine = if root_dir.join("voices.bin").is_file() {
            "kokoro"
        } else {
            "piper"
        };
        if !model_layout_valid(&stage, engine) {
            return Err("TTS_IMPORT_MODEL_INVALID".into());
        }
        let model_version = (engine == "kokoro")
            .then(|| kokoro_model_version(&stage))
            .flatten();
        let (mut name, locale) = archive_metadata(source);
        if engine == "kokoro"
            && name.as_deref().is_some_and(|value| {
                value
                    .strip_prefix('v')
                    .is_some_and(|rest| rest.chars().all(|character| character.is_ascii_digit()))
            })
        {
            name = None;
        }
        Ok(VoiceImportInspection {
            kind: "model-package",
            engine,
            format: "sherpa-onnx (.tar.bz2)",
            name: name.clone(),
            locale: locale.clone(),
            model_version,
            base_model_installed: true,
            requires_name: name.is_none(),
            requires_locale: locale.is_none(),
            size,
        })
    })();
    if stage.exists() {
        let _ = fs::remove_dir_all(stage);
    }
    result
}

#[tauri::command]
pub async fn local_tts_inspect_import(
    source_path: String,
    state: State<'_, TtsManager>,
) -> Result<VoiceImportInspection, String> {
    let source = validated_import_source(&state.root, &source_path)?;
    let root = state.root.clone();
    tauri::async_runtime::spawn_blocking(move || inspect_import_blocking(&root, &source))
        .await
        .map_err(|error| format!("TTS_IMPORT_FAILED:{error}"))?
}

fn extract_import_archive(source: &Path, stage: &Path) -> Result<(), String> {
    fs::create_dir_all(stage).map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
    let file = File::open(source).map_err(|error| format!("TTS_IMPORT_READ_FAILED:{error}"))?;
    let decoder = BzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    let mut expanded = 0u64;
    let mut count = 0u64;
    for entry in archive
        .entries()
        .map_err(|error| format!("TTS_IMPORT_ARCHIVE_INVALID:{error}"))?
    {
        count += 1;
        if count > MAX_IMPORT_ENTRIES {
            return Err("TTS_IMPORT_ARCHIVE_INVALID:too_many_entries".into());
        }
        let mut entry = entry.map_err(|error| format!("TTS_IMPORT_ARCHIVE_INVALID:{error}"))?;
        let kind = entry.header().entry_type();
        if !(kind.is_file() || kind.is_dir()) {
            return Err("TTS_IMPORT_ARCHIVE_INVALID:unsupported_entry".into());
        }
        expanded = expanded.saturating_add(entry.size());
        if expanded > MAX_IMPORT_EXPANDED_BYTES {
            return Err("TTS_IMPORT_ARCHIVE_INVALID:expanded_size".into());
        }
        if !entry
            .unpack_in(stage)
            .map_err(|error| format!("TTS_IMPORT_ARCHIVE_INVALID:{error}"))?
        {
            return Err("TTS_IMPORT_ARCHIVE_INVALID:path".into());
        }
    }
    Ok(())
}

fn import_individual_kokoro_voice(
    root: &Path,
    source: &Path,
    request: &VoiceImportRequest,
) -> Result<ImportedVoice, String> {
    validate_kokoro_voice_file(source)?;
    let (detected_name, detected_locale) = kokoro_voice_metadata(source);
    let name = validate_name(
        request
            .name
            .as_deref()
            .or(detected_name.as_deref())
            .ok_or("TTS_IMPORT_NAME_INVALID")?,
    )?;
    let locale = validate_locale(
        request
            .locale
            .as_deref()
            .or(detected_locale.as_deref())
            .ok_or("TTS_IMPORT_LOCALE_INVALID")?,
    )?;
    let model_version = "kokoro-1.0";
    let (package, _) =
        compatible_kokoro_base(root, model_version).ok_or("TTS_KOKORO_BASE_REQUIRED")?;
    let (sha256, bytes) = hash_file(source)?;
    if let Some((_, existing)) = individual_voice_manifests(root)
        .into_iter()
        .find(|(_, manifest)| manifest.voice_sha256 == sha256)
    {
        return Ok(existing.voice);
    }
    let id = format!("kokoro-imported-{}", &sha256[..16]);
    let voice_directory = individual_voice_root(root);
    fs::create_dir_all(&voice_directory).map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
    let used: HashSet<i32> = individual_voice_manifests(root)
        .into_iter()
        .filter(|(_, manifest)| manifest.voice.package_id == package.id)
        .map(|(_, manifest)| manifest.voice.speaker_id)
        .collect();
    let base_voices = fs::metadata(
        model_root(&package_dir(root, &package.id))
            .ok_or("TTS_MODEL_CORRUPT")?
            .join("voices.bin"),
    )
    .map_err(|error| format!("TTS_MODEL_CORRUPT:{error}"))?
    .len()
        / KOKORO_VOICE_BYTES;
    let speaker_id = (0..base_voices as i32)
        .find(|slot| !used.contains(slot))
        .ok_or("TTS_IMPORT_VOICE_LIMIT")?;
    let voice_file_name = format!("{id}.bin");
    let final_voice_path = voice_directory.join(&voice_file_name);
    let temporary_voice_path = voice_directory.join(format!("{id}.importing"));
    fs::copy(source, &temporary_voice_path)
        .map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
    let temporary_combined_path = voice_directory.join(format!("{id}-voices.importing"));
    rebuild_custom_voices(
        root,
        &package,
        Some((speaker_id, &temporary_voice_path)),
        &temporary_combined_path,
    )?;
    let catalog_voice = CatalogVoice {
        id: id.clone(),
        package_id: package.id.clone(),
        engine: "kokoro".into(),
        locale: locale.clone(),
        speaker_id,
    };
    let engine = create_engine_with_voice_file(
        root,
        &package,
        &catalog_voice,
        Some(&temporary_combined_path),
    )?;
    if let Err(error) = validate_voice_synthesis(&engine, speaker_id) {
        let _ = fs::remove_file(&temporary_voice_path);
        let _ = fs::remove_file(&temporary_combined_path);
        return Err(error);
    }
    fs::rename(&temporary_voice_path, &final_voice_path)
        .map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
    let combined_path = custom_voices_path(root, &package.id);
    if combined_path.exists() {
        fs::remove_file(&combined_path).map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
    }
    fs::rename(&temporary_combined_path, combined_path)
        .map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
    let region = locale
        .split('-')
        .nth(1)
        .unwrap_or_default()
        .to_ascii_uppercase();
    let voice = ImportedVoice {
        id: id.clone(),
        package_id: package.id.clone(),
        engine: "kokoro".into(),
        name,
        locale,
        region,
        speaker_id,
        quality: "imported".into(),
        imported: true,
        archive_sha256: sha256.clone(),
        storage_bytes: bytes,
        model_version: Some(model_version.into()),
        model_package_id: Some(package.id),
    };
    let manifest = IndividualVoiceManifest {
        schema_version: 1,
        voice: voice.clone(),
        voice_file: voice_file_name,
        voice_sha256: sha256,
        installed_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    };
    fs::write(
        voice_directory.join(format!("{id}.json")),
        serde_json::to_vec(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
    Ok(voice)
}

fn import_voice_blocking(
    root: &Path,
    source: &Path,
    request: VoiceImportRequest,
) -> Result<ImportedVoice, String> {
    if source
        .metadata()
        .map_err(|error| format!("TTS_IMPORT_READ_FAILED:{error}"))?
        .len()
        == KOKORO_VOICE_BYTES
    {
        return import_individual_kokoro_voice(root, source, &request);
    }
    let inspection = inspect_import_blocking(root, source)?;
    let engine = request
        .engine
        .as_deref()
        .unwrap_or(inspection.engine)
        .to_string();
    if engine != inspection.engine {
        return Err("TTS_IMPORT_ENGINE_INVALID".into());
    }
    let name = validate_name(
        request
            .name
            .as_deref()
            .or(inspection.name.as_deref())
            .ok_or("TTS_IMPORT_NAME_INVALID")?,
    )?;
    let locale = validate_locale(
        request
            .locale
            .as_deref()
            .or(inspection.locale.as_deref())
            .ok_or("TTS_IMPORT_LOCALE_INVALID")?,
    )?;
    let speaker_id = request.speaker_id.unwrap_or(0);
    if !(0..=4096).contains(&speaker_id) {
        return Err("TTS_IMPORT_SPEAKER_INVALID".into());
    }
    let (sha256, archive_bytes) = hash_file(source)?;
    let package_id = format!("imported-{}-{}", engine, &sha256[..16]);
    let final_path = package_dir(root, &package_id);
    if final_path.exists() {
        let manifest = fs::read(final_path.join("manifest.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ImportedManifest>(&bytes).ok())
            .ok_or_else(|| "TTS_MODEL_CORRUPT".to_string())?;
        if manifest.archive_sha256 != sha256
            || manifest.engine != engine
            || !model_layout_valid(&final_path, &manifest.engine)
        {
            return Err("TTS_MODEL_CORRUPT".into());
        }
        return manifest
            .voice
            .ok_or_else(|| "TTS_MODEL_CORRUPT".to_string());
    }

    let stage = root.join(format!("{package_id}.importing"));
    if stage.exists() {
        let _ = fs::remove_dir_all(&stage);
    }
    let result = (|| {
        extract_import_archive(source, &stage)?;
        if !model_layout_valid(&stage, &engine) {
            return Err("TTS_IMPORT_MODEL_INVALID".into());
        }
        let region = locale
            .split('-')
            .nth(1)
            .unwrap_or_default()
            .to_ascii_uppercase();
        let voice = ImportedVoice {
            id: format!("{package_id}-voice"),
            package_id: package_id.clone(),
            engine: engine.clone(),
            name,
            locale,
            region,
            speaker_id,
            quality: "imported".into(),
            imported: true,
            archive_sha256: sha256.clone(),
            storage_bytes: archive_bytes,
            model_version: inspection.model_version.clone(),
            model_package_id: Some(package_id.clone()),
        };
        let manifest = ImportedManifest {
            schema_version: 1,
            package_id: package_id.clone(),
            engine,
            archive_sha256: sha256,
            archive_bytes,
            voice: Some(voice.clone()),
            installed_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            imported: true,
            model_version: inspection.model_version,
        };
        fs::write(
            stage.join("manifest.json"),
            serde_json::to_vec(&manifest).map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
        fs::rename(&stage, &final_path).map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;

        let package = imported_package(&manifest);
        let catalog_voice = imported_catalog_voice(&manifest);
        let initialized = create_engine(root, &package, &catalog_voice)
            .map_err(|error| format!("TTS_IMPORT_MODEL_INVALID:{error}"))?;
        if let Err(error) = validate_voice_synthesis(&initialized, speaker_id) {
            let _ = fs::remove_dir_all(&final_path);
            return Err(format!("TTS_IMPORT_MODEL_INVALID:{error}"));
        }
        Ok(voice)
    })();
    if stage.exists() {
        let _ = fs::remove_dir_all(stage);
    }
    result
}

#[tauri::command]
pub async fn local_tts_import(
    request: VoiceImportRequest,
    state: State<'_, TtsManager>,
) -> Result<ImportedVoice, String> {
    let source = validated_import_source(&state.root, &request.source_path)?;
    let metadata = source
        .metadata()
        .map_err(|error| format!("TTS_IMPORT_READ_FAILED:{error}"))?;
    if fs2::available_space(&state.root).unwrap_or(u64::MAX) < metadata.len().saturating_mul(3) {
        return Err("TTS_INSUFFICIENT_STORAGE".into());
    }
    let root = state.root.clone();
    tauri::async_runtime::spawn_blocking(move || import_voice_blocking(&root, &source, request))
        .await
        .map_err(|error| format!("TTS_IMPORT_FAILED:{error}"))?
}

#[tauri::command]
pub fn local_tts_remove(package_id: String, state: State<'_, TtsManager>) -> Result<(), String> {
    let mut valid_ids: HashSet<String> = catalog()?
        .packages
        .into_iter()
        .map(|item| item.id)
        .collect();
    valid_ids.extend(
        imported_manifests(&state.root)
            .into_iter()
            .map(|(_, manifest)| manifest.package_id),
    );
    if !valid_ids.contains(&package_id) {
        return Err("TTS_PACKAGE_UNKNOWN".into());
    }
    state.synthesis_generation.fetch_add(1, Ordering::SeqCst);
    let mut cache = state.cached.lock().map_err(|_| "TTS_STATE_LOCKED")?;
    if cache
        .as_ref()
        .is_some_and(|item| item.key.starts_with(&package_id))
    {
        *cache = None;
    }
    drop(cache);
    let directory = package_dir(&state.root, &package_id);
    if directory.exists() {
        fs::remove_dir_all(directory).map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn local_tts_remove_voice(
    voice_id: String,
    state: State<'_, TtsManager>,
) -> Result<(), String> {
    state.synthesis_generation.fetch_add(1, Ordering::SeqCst);
    *state.cached.lock().map_err(|_| "TTS_STATE_LOCKED")? = None;
    if let Some((manifest_path, manifest)) = individual_voice_manifests(&state.root)
        .into_iter()
        .find(|(_, manifest)| manifest.voice.id == voice_id)
    {
        let package_id = manifest.voice.package_id.clone();
        let voice_path = manifest_path
            .parent()
            .unwrap_or(&state.root)
            .join(manifest.voice_file);
        if voice_path.exists() {
            fs::remove_file(voice_path).map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
        }
        fs::remove_file(manifest_path).map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
        let combined = custom_voices_path(&state.root, &package_id);
        if individual_voice_manifests(&state.root)
            .into_iter()
            .any(|(_, item)| item.voice.package_id == package_id)
        {
            let package = package_by_id(&state.root, &package_id).ok_or("TTS_PACKAGE_UNKNOWN")?;
            let temporary = combined.with_extension("importing");
            rebuild_custom_voices(&state.root, &package, None, &temporary)?;
            if combined.exists() {
                fs::remove_file(&combined)
                    .map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
            }
            fs::rename(temporary, combined)
                .map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
        } else if combined.exists() {
            fs::remove_file(combined).map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
        }
        return Ok(());
    }
    if let Some((directory, mut manifest)) =
        imported_manifests(&state.root)
            .into_iter()
            .find(|(_, manifest)| {
                manifest
                    .voice
                    .as_ref()
                    .is_some_and(|voice| voice.id == voice_id)
            })
    {
        if manifest.engine == "piper" {
            fs::remove_dir_all(directory).map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
        } else {
            manifest.voice = None;
            fs::write(
                directory.join("manifest.json"),
                serde_json::to_vec(&manifest).map_err(|error| error.to_string())?,
            )
            .map_err(|error| format!("TTS_STORAGE_FAILED:{error}"))?;
        }
        return Ok(());
    }
    Err("TTS_VOICE_NOT_MANAGED".into())
}

fn locale_frontend(locale: &str) -> String {
    match locale.to_ascii_lowercase().as_str() {
        value if value.starts_with("en-gb") => "en-gb",
        value if value.starts_with("en") => "en-us",
        value if value.starts_with("fr") => "fr-fr",
        value if value.starts_with("it") => "it",
        value if value.starts_with("es") => "es",
        other => other.split('-').next().unwrap_or("en"),
    }
    .to_string()
}

fn create_engine(
    root: &Path,
    package: &CatalogPackage,
    voice: &CatalogVoice,
) -> Result<OfflineTts, String> {
    create_engine_with_voice_file(root, package, voice, None)
}

fn create_engine_with_voice_file(
    root: &Path,
    package: &CatalogPackage,
    voice: &CatalogVoice,
    voice_file: Option<&Path>,
) -> Result<OfflineTts, String> {
    let directory = package_dir(root, &package.id);
    let model_root = model_root(&directory).ok_or_else(|| "TTS_MODEL_CORRUPT".to_string())?;
    let model = find_file(&model_root, |path| {
        path.extension().is_some_and(|ext| ext == "onnx")
    })
    .ok_or_else(|| "TTS_MODEL_CORRUPT".to_string())?;
    let path = |name: &str| model_root.join(name).to_string_lossy().into_owned();
    let model_path = model.to_string_lossy().into_owned();
    let mut model_config = OfflineTtsModelConfig {
        num_threads: 2,
        debug: false,
        provider: Some("cpu".into()),
        ..Default::default()
    };
    if package.engine == "piper" {
        model_config.vits = OfflineTtsVitsModelConfig {
            model: Some(model_path),
            tokens: Some(path("tokens.txt")),
            data_dir: Some(path("espeak-ng-data")),
            ..Default::default()
        };
    } else if package.engine == "kokoro" {
        let language = locale_frontend(&voice.locale);
        let lexicon = if language == "en-us" && model_root.join("lexicon-us-en.txt").is_file() {
            Some(path("lexicon-us-en.txt"))
        } else if language == "en-gb" && model_root.join("lexicon-gb-en.txt").is_file() {
            Some(path("lexicon-gb-en.txt"))
        } else {
            None
        };
        model_config.kokoro = OfflineTtsKokoroModelConfig {
            model: Some(model_path),
            voices: Some(
                voice_file
                    .map(|file| file.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path("voices.bin")),
            ),
            tokens: Some(path("tokens.txt")),
            data_dir: Some(path("espeak-ng-data")),
            dict_dir: model_root.join("dict").is_dir().then(|| path("dict")),
            lexicon,
            lang: Some(language),
            ..Default::default()
        };
    } else {
        return Err("TTS_ENGINE_UNAVAILABLE".into());
    }
    OfflineTts::create(&OfflineTtsConfig {
        model: model_config,
        max_num_sentences: 1,
        silence_scale: 0.2,
        ..Default::default()
    })
    .ok_or_else(|| "TTS_INITIALIZATION_FAILED".to_string())
}

fn validate_voice_synthesis(engine: &OfflineTts, speaker_id: i32) -> Result<(), String> {
    let audio = engine
        .generate_with_config(
            IMPORT_VALIDATION_TEXT,
            &GenerationConfig {
                speed: 1.0,
                sid: speaker_id,
                silence_scale: 0.2,
                ..Default::default()
            },
            None::<fn(&[f32], f32) -> bool>,
        )
        .ok_or_else(|| "TTS_IMPORT_SYNTHESIS_FAILED".to_string())?;
    if audio.sample_rate() <= 8_000 || audio.samples().len() < audio.sample_rate() as usize / 5 {
        return Err("TTS_IMPORT_SYNTHESIS_FAILED".into());
    }
    Ok(())
}

fn wav_bytes(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, String> {
    let mut cursor = Cursor::new(Vec::new());
    {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer =
            hound::WavWriter::new(&mut cursor, spec).map_err(|error| error.to_string())?;
        for sample in samples {
            let pcm = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            writer
                .write_sample(pcm)
                .map_err(|error| error.to_string())?;
        }
        writer.finalize().map_err(|error| error.to_string())?;
    }
    Ok(cursor.into_inner())
}

#[tauri::command]
pub async fn local_tts_synthesize(
    voice_id: String,
    text: String,
    rate: f32,
    state: State<'_, TtsManager>,
) -> Result<SynthesizedAudio, String> {
    let count = text.chars().count();
    if text.trim().is_empty() || count > MAX_TEXT_CHARS || !(0.5..=2.0).contains(&rate) {
        return Err("TTS_INVALID_REQUEST".into());
    }
    let catalog = catalog()?;
    let built_in_voice = catalog.voices.into_iter().find(|item| item.id == voice_id);
    let imported = imported_manifests(&state.root)
        .into_iter()
        .map(|(_, manifest)| manifest)
        .find(|manifest| {
            manifest
                .voice
                .as_ref()
                .is_some_and(|voice| voice.id == voice_id)
        });
    let individual = individual_voice_manifests(&state.root)
        .into_iter()
        .find(|(_, manifest)| manifest.voice.id == voice_id);
    let (voice, package, voice_file) = if let Some(voice) = built_in_voice {
        let package = catalog
            .packages
            .into_iter()
            .find(|item| item.id == voice.package_id)
            .ok_or_else(|| "TTS_PACKAGE_UNKNOWN".to_string())?;
        (voice, package, None)
    } else if let Some(manifest) = imported {
        (
            imported_catalog_voice(&manifest),
            imported_package(&manifest),
            None,
        )
    } else if let Some((manifest_path, manifest)) = individual {
        let package =
            package_by_id(&state.root, &manifest.voice.package_id).ok_or("TTS_PACKAGE_UNKNOWN")?;
        let combined = custom_voices_path(&state.root, &package.id);
        if !combined.is_file() {
            rebuild_custom_voices(&state.root, &package, None, &combined)?;
        }
        let voice = CatalogVoice {
            id: manifest.voice.id.clone(),
            package_id: manifest.voice.package_id.clone(),
            engine: "kokoro".into(),
            locale: manifest.voice.locale.clone(),
            speaker_id: manifest.voice.speaker_id,
        };
        let _ = manifest_path;
        (voice, package, Some(combined))
    } else {
        return Err("TTS_VOICE_UNKNOWN".into());
    };
    if voice.engine != package.engine || !package_valid(&state.root, &package) {
        return Err("TTS_VOICE_NOT_INSTALLED".into());
    }
    let key = format!(
        "{}:{}:{}",
        package.id,
        voice.id,
        locale_frontend(&voice.locale)
    );
    let engine = {
        let cache = state.cached.lock().map_err(|_| "TTS_STATE_LOCKED")?;
        cache
            .as_ref()
            .filter(|item| item.key == key)
            .map(|item| item.engine.clone())
    };
    let root = state.root.clone();
    let engine = match engine {
        Some(engine) => engine,
        None => {
            let package_copy = package.clone();
            let voice_copy = voice.clone();
            let voice_file_copy = voice_file.clone();
            let created = tauri::async_runtime::spawn_blocking(move || {
                create_engine_with_voice_file(
                    &root,
                    &package_copy,
                    &voice_copy,
                    voice_file_copy.as_deref(),
                )
            })
            .await
            .map_err(|error| format!("TTS_INITIALIZATION_FAILED:{error}"))??;
            let engine = Arc::new(created);
            *state.cached.lock().map_err(|_| "TTS_STATE_LOCKED")? = Some(CachedEngine {
                key,
                engine: engine.clone(),
            });
            engine
        }
    };
    let generation = state.synthesis_generation.load(Ordering::SeqCst);
    let generation_source = state.synthesis_generation.clone();
    let speaker_id = voice.speaker_id;
    let output =
        tauri::async_runtime::spawn_blocking(move || -> Result<(Vec<u8>, i32, usize), String> {
            let cancellation = generation_source.clone();
            let audio = engine
                .generate_with_config(
                    &text,
                    &GenerationConfig {
                        speed: rate,
                        sid: speaker_id,
                        silence_scale: 0.2,
                        ..Default::default()
                    },
                    Some(move |_samples: &[f32], _progress: f32| {
                        cancellation.load(Ordering::SeqCst) == generation
                    }),
                )
                .ok_or_else(|| "TTS_SYNTHESIS_CANCELLED".to_string())?;
            if generation_source.load(Ordering::SeqCst) != generation {
                return Err("TTS_SYNTHESIS_CANCELLED".into());
            }
            let sample_rate = audio.sample_rate();
            let sample_count = audio.samples().len();
            let wav = wav_bytes(audio.samples(), sample_rate as u32)?;
            Ok((wav, sample_rate, sample_count))
        })
        .await
        .map_err(|error| format!("TTS_SYNTHESIS_FAILED:{error}"))??;
    Ok(SynthesizedAudio {
        data_base64: BASE64.encode(output.0),
        mime_type: "audio/wav",
        duration_ms: (output.2 as u64).saturating_mul(1000) / output.1.max(1) as u64,
    })
}

#[tauri::command]
pub fn local_tts_cancel_synthesis(state: State<'_, TtsManager>) {
    state.synthesis_generation.fetch_add(1, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_metadata_is_bounded_and_normalized() {
        assert_eq!(validate_name("  Autumn voice  ").unwrap(), "Autumn voice");
        assert_eq!(validate_locale("es_AR").unwrap(), "es-AR");
        assert!(validate_name("").is_err());
        assert!(validate_locale("not a locale").is_err());
    }

    #[test]
    fn imported_layout_requires_engine_specific_files() {
        let scratch =
            std::env::temp_dir().join(format!("autumn-import-layout-{}", std::process::id()));
        let _ = fs::remove_dir_all(&scratch);
        fs::create_dir_all(scratch.join("espeak-ng-data")).expect("data directory");
        fs::write(scratch.join("tokens.txt"), "a 0").expect("tokens");
        fs::write(scratch.join("model.onnx"), b"model").expect("model");
        assert!(model_layout_valid(&scratch, "piper"));
        assert!(!model_layout_valid(&scratch, "kokoro"));
        fs::write(scratch.join("voices.bin"), b"voices").expect("voices");
        assert!(model_layout_valid(&scratch, "kokoro"));
        fs::remove_dir_all(scratch).expect("remove layout fixture");
    }

    #[test]
    fn individual_kokoro_voice_requires_one_finite_style_block() {
        let scratch =
            std::env::temp_dir().join(format!("autumn-kokoro-voice-{}", std::process::id()));
        let _ = fs::remove_file(&scratch);
        fs::write(&scratch, vec![0u8; KOKORO_VOICE_BYTES as usize]).expect("write style block");
        validate_kokoro_voice_file(&scratch).expect("valid finite style block");
        fs::write(&scratch, vec![0u8; 32]).expect("write short style block");
        assert!(validate_kokoro_voice_file(&scratch).is_err());
        fs::remove_file(scratch).expect("remove fixture");
        let (name, locale) = kokoro_voice_metadata(Path::new("af_heart-tts-import-123.bin"));
        assert_eq!(name.as_deref(), Some("Heart"));
        assert_eq!(locale.as_deref(), Some("en-US"));
    }

    #[test]
    #[ignore = "requires AUTUMN_TTS_TEST_ARCHIVE pointing to the verified Piper archive"]
    fn imported_piper_archive_is_installed_and_executable() {
        let archive_path =
            PathBuf::from(std::env::var("AUTUMN_TTS_TEST_ARCHIVE").expect("archive path"));
        let scratch =
            std::env::temp_dir().join(format!("autumn-import-smoke-{}", std::process::id()));
        let _ = fs::remove_dir_all(&scratch);
        fs::create_dir_all(&scratch).expect("create import root");
        let voice = import_voice_blocking(
            &scratch,
            &archive_path,
            VoiceImportRequest {
                source_path: archive_path.to_string_lossy().into_owned(),
                engine: Some("piper".into()),
                name: Some("Imported Carl FM".into()),
                locale: Some("es-ES".into()),
                speaker_id: Some(0),
            },
        )
        .expect("import voice");
        assert!(voice.imported);
        assert_eq!(imported_manifests(&scratch).len(), 1);
        let manifest = imported_manifests(&scratch).remove(0).1;
        let engine = create_engine(
            &scratch,
            &imported_package(&manifest),
            &imported_catalog_voice(&manifest),
        )
        .expect("initialize imported Piper");
        let audio = engine
            .generate_with_config(
                "La voz importada funciona sin conexión.",
                &GenerationConfig {
                    speed: 1.0,
                    sid: 0,
                    ..Default::default()
                },
                None::<fn(&[f32], f32) -> bool>,
            )
            .expect("synthesize imported voice");
        assert!(audio.samples().len() > audio.sample_rate() as usize / 2);
        fs::remove_dir_all(scratch).expect("remove import fixture");
    }

    #[test]
    #[ignore = "requires AUTUMN_TTS_TEST_ARCHIVE pointing to the verified Piper archive"]
    fn piper_smoke_from_verified_archive() {
        let archive_path =
            PathBuf::from(std::env::var("AUTUMN_TTS_TEST_ARCHIVE").expect("archive path"));
        let catalog = catalog().expect("valid catalog");
        let package = catalog
            .packages
            .into_iter()
            .find(|item| item.id == "piper-es-es-carlfm-x-low-int8")
            .expect("Piper package");
        let voice = catalog
            .voices
            .into_iter()
            .find(|item| item.id == "piper-es-carlfm")
            .expect("Piper voice");
        let archive_bytes = fs::read(&archive_path).expect("read archive");
        assert_eq!(archive_bytes.len() as u64, package.size);
        assert_eq!(
            format!("{:x}", Sha256::digest(&archive_bytes)),
            package.sha256
        );

        let scratch = std::env::temp_dir().join(format!("autumn-tts-smoke-{}", std::process::id()));
        let package_root = package_dir(&scratch, &package.id);
        fs::create_dir_all(&package_root).expect("create smoke directory");
        let decoder = BzDecoder::new(Cursor::new(archive_bytes));
        tar::Archive::new(decoder)
            .unpack(&package_root)
            .expect("extract verified archive");
        let engine = create_engine(&scratch, &package, &voice).expect("initialize Piper");
        let audio = engine
            .generate_with_config(
                "Esta es una prueba local de Autumn Reader.",
                &GenerationConfig {
                    speed: 1.0,
                    sid: voice.speaker_id,
                    silence_scale: 0.2,
                    ..Default::default()
                },
                None::<fn(&[f32], f32) -> bool>,
            )
            .expect("synthesize speech");
        assert!(audio.sample_rate() > 8_000);
        assert!(audio.samples().len() > audio.sample_rate() as usize / 2);
        fs::remove_dir_all(&scratch).expect("remove smoke directory");
    }

    #[test]
    #[ignore = "requires AUTUMN_TTS_TEST_KOKORO_ARCHIVE pointing to the verified Kokoro archive"]
    fn kokoro_smoke_from_verified_archive() {
        let archive_path =
            PathBuf::from(std::env::var("AUTUMN_TTS_TEST_KOKORO_ARCHIVE").expect("archive path"));
        let catalog = catalog().expect("valid catalog");
        let package = catalog
            .packages
            .into_iter()
            .find(|item| item.id == "kokoro-multilingual-v1-int8")
            .expect("Kokoro package");
        let voice = catalog
            .voices
            .into_iter()
            .find(|item| item.id == "kokoro-es-dora")
            .expect("Kokoro voice");
        let archive_bytes = fs::read(&archive_path).expect("read archive");
        assert_eq!(archive_bytes.len() as u64, package.size);
        assert_eq!(
            format!("{:x}", Sha256::digest(&archive_bytes)),
            package.sha256
        );

        let scratch =
            std::env::temp_dir().join(format!("autumn-kokoro-smoke-{}", std::process::id()));
        let package_root = package_dir(&scratch, &package.id);
        fs::create_dir_all(&package_root).expect("create smoke directory");
        let decoder = BzDecoder::new(Cursor::new(archive_bytes));
        tar::Archive::new(decoder)
            .unpack(&package_root)
            .expect("extract verified archive");
        let engine = create_engine(&scratch, &package, &voice).expect("initialize Kokoro");
        let audio = engine
            .generate_with_config(
                "Esta es una prueba local de Autumn Reader.",
                &GenerationConfig {
                    speed: 1.0,
                    sid: voice.speaker_id,
                    silence_scale: 0.2,
                    ..Default::default()
                },
                None::<fn(&[f32], f32) -> bool>,
            )
            .expect("synthesize speech");
        assert!(audio.sample_rate() > 8_000);
        assert!(audio.samples().len() > audio.sample_rate() as usize / 2);
        fs::remove_dir_all(&scratch).expect("remove smoke directory");
    }

    #[test]
    #[ignore = "requires AUTUMN_TTS_TEST_KOKORO_ARCHIVE and two AUTUMN_TTS_TEST_KOKORO_VOICE files"]
    fn individual_kokoro_voice_reuses_base_and_synthesizes() {
        let archive_path =
            PathBuf::from(std::env::var("AUTUMN_TTS_TEST_KOKORO_ARCHIVE").expect("archive path"));
        let voice_path =
            PathBuf::from(std::env::var("AUTUMN_TTS_TEST_KOKORO_VOICE").expect("voice path"));
        let second_voice_path = PathBuf::from(
            std::env::var("AUTUMN_TTS_TEST_KOKORO_VOICE_2").expect("second voice path"),
        );
        let scratch =
            std::env::temp_dir().join(format!("autumn-kokoro-individual-{}", std::process::id()));
        let _ = fs::remove_dir_all(&scratch);
        fs::create_dir_all(&scratch).expect("create import root");
        let base_voice = import_voice_blocking(
            &scratch,
            &archive_path,
            VoiceImportRequest {
                source_path: archive_path.to_string_lossy().into_owned(),
                engine: Some("kokoro".into()),
                name: Some("Kokoro base".into()),
                locale: Some("en-US".into()),
                speaker_id: Some(0),
            },
        )
        .expect("import compatible base model");
        let package =
            package_by_id(&scratch, &base_voice.package_id).expect("imported base package");
        let voice = import_individual_kokoro_voice(
            &scratch,
            &voice_path,
            &VoiceImportRequest {
                source_path: voice_path.to_string_lossy().into_owned(),
                engine: None,
                name: Some("Heart".into()),
                locale: Some("en-US".into()),
                speaker_id: None,
            },
        )
        .expect("import individual voice");
        let manifest = individual_voice_manifests(&scratch)
            .into_iter()
            .find(|(_, manifest)| manifest.voice.id == voice.id)
            .expect("voice manifest")
            .1;
        let voice_file = custom_voices_path(&scratch, &package.id);
        let catalog_voice = CatalogVoice {
            id: voice.id.clone(),
            package_id: voice.package_id.clone(),
            engine: "kokoro".into(),
            locale: "en-US".into(),
            speaker_id: manifest.voice.speaker_id,
        };
        let engine =
            create_engine_with_voice_file(&scratch, &package, &catalog_voice, Some(&voice_file))
                .expect("initialize individual voice");
        validate_voice_synthesis(&engine, manifest.voice.speaker_id)
            .expect("synthesize individual voice");
        let second = import_individual_kokoro_voice(
            &scratch,
            &second_voice_path,
            &VoiceImportRequest {
                source_path: second_voice_path.to_string_lossy().into_owned(),
                engine: None,
                name: Some("Michael".into()),
                locale: Some("en-US".into()),
                speaker_id: None,
            },
        )
        .expect("import second individual voice");
        assert_eq!(voice.package_id, second.package_id);
        assert_ne!(voice.speaker_id, second.speaker_id);
        assert_eq!(individual_voice_manifests(&scratch).len(), 2);
        assert_eq!(
            fs::metadata(&voice_file).unwrap().len(),
            54 * KOKORO_VOICE_BYTES
        );
        let second_catalog = CatalogVoice {
            id: second.id,
            package_id: second.package_id,
            engine: "kokoro".into(),
            locale: "en-US".into(),
            speaker_id: second.speaker_id,
        };
        let second_engine =
            create_engine_with_voice_file(&scratch, &package, &second_catalog, Some(&voice_file))
                .expect("initialize second voice");
        validate_voice_synthesis(&second_engine, second.speaker_id)
            .expect("synthesize second voice");
        fs::remove_dir_all(scratch).expect("remove fixture");
    }
}
