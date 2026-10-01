import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { CloudError } from "../errors";
export async function hashBlob(
  blob: Blob,
  signal?: AbortSignal,
): Promise<string> {
  const digest = sha256.create();
  // Bounded memory and event-loop yields also work on Android WebView.
  for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
    if (signal?.aborted) throw new CloudError("cancelled");
    digest.update(
      new Uint8Array(
        await blob.slice(offset, offset + 1024 * 1024).arrayBuffer(),
      ),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (signal?.aborted) throw new CloudError("cancelled");
  return bytesToHex(digest.digest());
}
