use std::collections::HashMap;
use std::path::Path;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

#[tauri::command]
pub(crate) async fn download_to_file(
    url: String,
    headers: HashMap<String, String>,
    dest_path: String,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let mut req = client.get(&url);
    for (k, v) in headers {
        req = req.header(k, v);
    }

    let mut res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("Download failed with status: {status}"));
    }

    let download_result = async {
        let mut file = File::create(Path::new(&dest_path))
            .await
            .map_err(|e| e.to_string())?;
        while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        }
        file.flush().await.map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    }
    .await;

    match download_result {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = tokio::fs::remove_file(&dest_path).await;
            Err(e)
        }
    }
}
