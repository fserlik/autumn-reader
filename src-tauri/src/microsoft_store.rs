use serde::Serialize;
use std::sync::mpsc;
use tauri::WebviewWindow;
use windows::{
    core::{Interface, HSTRING},
    Services::Store::{
        StoreContext, StoreProductQueryResult, StorePurchaseResult, StorePurchaseStatus,
    },
    Win32::UI::Shell::IInitializeWithWindow,
};
use windows_collections::IVectorView;

const PRODUCT_IDS: [&str; 4] = [
    "autumn_plus_monthly",
    "autumn_plus_yearly",
    "autumn_pro_monthly",
    "autumn_pro_yearly",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrosoftStoreProduct {
    product_id: String,
    store_id: String,
    title: String,
    formatted_price: String,
    formatted_recurrence_price: String,
    owned: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrosoftStorePurchase {
    status: String,
    extended_error: i32,
}

fn store_error(error: windows::core::Error) -> String {
    format!("microsoft_store:{}", error.code().0)
}

fn context(window: &WebviewWindow) -> Result<StoreContext, String> {
    let context = StoreContext::GetDefault().map_err(store_error)?;
    let initializer: IInitializeWithWindow = context.cast().map_err(store_error)?;
    // StoreContext is a WinRT UI object. Desktop apps must attach the owner
    // HWND before showing Microsoft Store UI.
    unsafe { initializer.Initialize(window.hwnd().map_err(|error| error.to_string())?) }
        .map_err(store_error)?;
    Ok(context)
}

fn on_ui_thread<T, F>(window: &WebviewWindow, action: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&WebviewWindow) -> Result<T, String> + Send + 'static,
{
    let (sender, receiver) = mpsc::sync_channel(1);
    let owner = window.clone();
    window
        .run_on_main_thread(move || {
            let result = action(&owner);
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .map_err(|_| "microsoft_store:ui_thread".to_owned())?
}

fn start_product_query(
    window: &WebviewWindow,
) -> Result<windows_future::IAsyncOperation<StoreProductQueryResult>, String> {
    let kinds: IVectorView<HSTRING> = vec![HSTRING::from("Durable")].into();
    context(window)?
        .GetAssociatedStoreProductsAsync(&kinds)
        .map_err(store_error)
}

fn start_purchase(
    window: &WebviewWindow,
    store_id: String,
) -> Result<windows_future::IAsyncOperation<StorePurchaseResult>, String> {
    context(window)?
        .RequestPurchaseAsync(&HSTRING::from(store_id))
        .map_err(store_error)
}

fn start_purchase_id(
    window: &WebviewWindow,
    service_ticket: String,
    publisher_user_id: String,
) -> Result<windows_future::IAsyncOperation<HSTRING>, String> {
    context(window)?
        .GetCustomerPurchaseIdAsync(
            &HSTRING::from(service_ticket),
            &HSTRING::from(publisher_user_id),
        )
        .map_err(store_error)
}

#[tauri::command]
pub async fn microsoft_store_products(
    window: WebviewWindow,
) -> Result<Vec<MicrosoftStoreProduct>, String> {
    let operation = on_ui_thread(&window, start_product_query)?;
    let query = operation.await.map_err(store_error)?;
    let extended = query.ExtendedError().map_err(store_error)?;
    if extended.is_err() {
        return Err(format!("microsoft_store:{}", extended.0));
    }
    let mut products = Vec::new();
    for entry in query.Products().map_err(store_error)? {
        let product = entry.Value().map_err(store_error)?;
        let product_id = product.InAppOfferToken().map_err(store_error)?.to_string();
        if !PRODUCT_IDS.contains(&product_id.as_str()) {
            continue;
        }
        let price = product.Price().map_err(store_error)?;
        products.push(MicrosoftStoreProduct {
            product_id,
            store_id: product.StoreId().map_err(store_error)?.to_string(),
            title: product.Title().map_err(store_error)?.to_string(),
            formatted_price: price.FormattedPrice().map_err(store_error)?.to_string(),
            formatted_recurrence_price: price
                .FormattedRecurrencePrice()
                .map_err(store_error)?
                .to_string(),
            owned: product.IsInUserCollection().map_err(store_error)?,
        });
    }
    Ok(products)
}

#[tauri::command]
pub async fn microsoft_store_purchase(
    window: WebviewWindow,
    store_id: String,
) -> Result<MicrosoftStorePurchase, String> {
    if store_id.len() != 12
        || !store_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return Err("microsoft_store:invalid_store_id".to_owned());
    }
    let operation = on_ui_thread(&window, move |owner| start_purchase(owner, store_id))?;
    let purchase = operation.await.map_err(store_error)?;
    let status = purchase.Status().map_err(store_error)?;
    let status_name = if status == StorePurchaseStatus::Succeeded {
        "succeeded"
    } else if status == StorePurchaseStatus::AlreadyPurchased {
        "already_purchased"
    } else if status == StorePurchaseStatus::NotPurchased {
        "not_purchased"
    } else if status == StorePurchaseStatus::NetworkError {
        "network_error"
    } else {
        "server_error"
    };
    Ok(MicrosoftStorePurchase {
        status: status_name.to_owned(),
        extended_error: purchase.ExtendedError().map_err(store_error)?.0,
    })
}

#[tauri::command]
pub async fn microsoft_store_customer_purchase_id(
    window: WebviewWindow,
    service_ticket: String,
    publisher_user_id: String,
) -> Result<String, String> {
    if service_ticket.len() > 16_384
        || publisher_user_id.len() != 36
        || !publisher_user_id
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
    {
        return Err("microsoft_store:invalid_identity".to_owned());
    }
    let operation = on_ui_thread(&window, move |owner| {
        start_purchase_id(owner, service_ticket, publisher_user_id)
    })?;
    let key = operation.await.map_err(store_error)?.to_string();
    if key.is_empty() || key.len() > 16_384 {
        return Err("microsoft_store:invalid_purchase_id".to_owned());
    }
    Ok(key)
}
