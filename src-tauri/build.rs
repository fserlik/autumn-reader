fn main() {
    println!("cargo:rerun-if-changed=../.env");
    println!("cargo:rerun-if-env-changed=AUTUMN_GOOGLE_CLIENT_SECRET");
    let from_environment = std::env::var("AUTUMN_GOOGLE_CLIENT_SECRET").ok();
    let from_file = std::fs::read_to_string("../.env")
        .ok()
        .and_then(|contents| {
            contents.lines().find_map(|line| {
                let (key, value) = line.trim().split_once('=')?;
                (key.trim() == "AUTUMN_GOOGLE_CLIENT_SECRET")
                    .then(|| value.trim().trim_matches(['"', '\'']).to_string())
            })
        });
    if let Some(secret) = from_environment
        .or(from_file)
        .filter(|value| !value.is_empty())
    {
        if secret.len() > 512
            || !secret.chars().all(|character| {
                character.is_ascii_alphanumeric() || character == '-' || character == '_'
            })
        {
            panic!("AUTUMN_GOOGLE_CLIENT_SECRET tiene un formato inválido");
        }
        println!("cargo:rustc-env=AUTUMN_GOOGLE_CLIENT_SECRET={secret}");
    }
    tauri_build::build()
}
