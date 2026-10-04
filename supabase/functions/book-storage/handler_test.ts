// No network or real credentials. Mock fetch exercises Auth + RPC + R2 boundary.
import { assertEquals, assert } from "jsr:@std/assert@1";
import JSZip from "npm:jszip@3.10.1";
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("R2_ACCOUNT_ID", "0".repeat(32));
Deno.env.set("R2_ACCESS_KEY_ID", "dummy-access");
Deno.env.set("R2_SECRET_ACCESS_KEY", "dummy-secret");
Deno.env.set("R2_BUCKET", "private-books");
Deno.env.set("ALLOWED_ORIGINS", "http://127.0.0.1:1420");
const { handleRequest } = await import("./handler.ts");
const owner = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  book = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
  intentId = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const session = "dddddddd-dddd-4ddd-dddd-dddddddddddd";
const accessToken = `test.${btoa(JSON.stringify({session_id:session}))}.signature`;
const file = new TextEncoder().encode("%PDF-1.4\nfixture\n%%EOF");
const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", file))]
  .map((n) => n.toString(16).padStart(2, "0"))
  .join("");
const request = (body: unknown, token = true) =>
  new Request("https://example.supabase.co/functions/v1/book-storage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:1420",
      ...(token ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
function mock(
  overrides: {
    authorized?: boolean;
    bytes?: Uint8Array;
    completed?: boolean;
    hash?: string;
    format?: "epub" | "pdf";
    quotaReason?: "storage_limit" | "pending_upload_limit" | "upload_rate_limited";
    removeDenied?: boolean;
    deviceDenied?: boolean;
  } = {},
) {
  const previous = globalThis.fetch;
  const calls: { url: string; method: string; headers: Headers }[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    calls.push({ url: req.url, method: req.method, headers: req.headers });
    if (url.pathname === "/auth/v1/user")
      return Response.json({
        id: owner,
        aud: "authenticated",
        role: "authenticated",
        email: "test@example.org",
      });
    if (url.pathname.endsWith("authorize_account_device")) {
      const input = await req.json() as {p_user:string;p_session:string};
      return Response.json(!overrides.deviceDenied && input.p_user===owner && input.p_session===session);
    }
    if (url.pathname.endsWith("reserve_book_upload") && overrides.quotaReason)
      return Response.json({ code: "P0001", message: overrides.quotaReason,
        details: JSON.stringify({used_books:14,active_pending_uploads:0,used_bytes:19600000,reserved_bytes:0}) }, {status:400});
    if (url.pathname.endsWith("reserve_book_upload"))
      return Response.json({
        id: intentId,
        user_id: owner,
        file_hash: overrides.hash ?? hash,
        file_size: overrides.bytes?.length ?? file.length,
        format: overrides.format ?? "pdf",
        staging_key: `staging/${owner}/${intentId}`,
        completed_at: null,
        book_id: null,
      });
    if (url.pathname.endsWith("get_upload_intent"))
      return Response.json({
        id: intentId,
        user_id: owner,
        file_hash: overrides.hash ?? hash,
        file_size: overrides.bytes?.length ?? file.length,
        format: overrides.format ?? "pdf",
        staging_key: `staging/${owner}/${intentId}`,
        completed_at: overrides.completed ? new Date().toISOString() : null,
        book_id: overrides.completed ? book : null,
      });
    if (url.pathname.endsWith("authorize_book_download"))
      return Response.json(
        overrides.authorized
          ? {
              file_hash: hash,
              file_size: file.length,
              format: "pdf",
              r2_key: `books/${hash}.pdf`,
            }
          : null,
      );
    if (url.pathname.endsWith("complete_book_upload"))
      return Response.json({ book_id: book });
    if (url.pathname.endsWith("remove_cloud_book")) {
      const payload = await req.json() as { p_user: string; p_book: string };
      if (overrides.removeDenied || payload.p_user !== owner || payload.p_book !== book)
        return Response.json({ message: "forbidden" }, { status: 400 });
      return Response.json({ removed: true, remaining_references: 1,
        cancelled_staging_keys: [`staging/${owner}/${intentId}`],
        usage: { used_books: 13, used_bytes: 15000000, max_bytes: 1073741824 } });
    }
    if (url.hostname.endsWith("r2.cloudflarestorage.com")) {
      if (req.method === "GET") {
        const bytes = overrides.bytes ?? file;
        return new Response(new Uint8Array(bytes), {
          headers: { "content-length": String(bytes.length), etag: '"etag"' },
        });
      }
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected mock request ${url.pathname}`);
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = previous;
    },
  };
}
Deno.test("requires authentication and exact Origin", async () => {
  assertEquals(
    (await handleRequest(request({ action: "download", bookId: book }, false)))
      .status,
    401,
  );
  const bad = new Request(
    "https://example.supabase.co/functions/v1/book-storage",
    { method: "POST", headers: { Origin: "https://evil.test" }, body: "{}" },
  );
  assertEquals((await handleRequest(bad)).status, 403);
});
Deno.test("a signed-in third device cannot prepare or download private book files", async () => {
  const m = mock({ authorized: true, deviceDenied: true });
  try {
    const denied = await handleRequest(request({ action: "download", bookId: book }));
    assertEquals(denied.status, 403);
    assertEquals(await denied.json(), { code: "device_limit" });
    assertEquals(m.calls.filter(c => c.url.includes("r2.cloudflarestorage.com")).length, 0);
  } finally { m.restore(); }
});
Deno.test(
  "signed upload fixes length, type, object and immutable condition",
  async () => {
    const m = mock();
    try {
      const response = await handleRequest(
        request({
          action: "prepare",
          hash,
          format: "pdf",
          size: file.length,
          title: "Title",
        }),
      );
      assertEquals(response.status, 200);
      const body = await response.json();
      const url = new URL(body.url);
      assert(url.pathname.includes(`/staging/${owner}/${intentId}`));
      assertEquals(url.searchParams.get("X-Amz-Expires"), "300");
      assertEquals(
        url.searchParams.get("X-Amz-SignedHeaders"),
        "content-length;content-type;host;if-none-match",
      );
      assertEquals(body.headers["If-None-Match"], "*");
    } finally {
      m.restore();
    }
  },
);
Deno.test(
  "public metadata or known UUID cannot authorize download",
  async () => {
    const m = mock();
    try {
      const response = await handleRequest(
        request({ action: "download", bookId: book }),
      );
      assertEquals(response.status, 403);
      assertEquals(
        m.calls.filter((c) => c.url.includes("r2.cloudflarestorage.com"))
          .length,
        0,
      );
    } finally {
      m.restore();
    }
  },
);
Deno.test(
  "authorized download is short lived and never lists the bucket",
  async () => {
    const m = mock({ authorized: true });
    try {
      const response = await handleRequest(
        request({ action: "download", bookId: book }),
      );
      assertEquals(response.status, 200);
      const body = await response.json();
      assertEquals(new URL(body.url).searchParams.get("X-Amz-Expires"), "120");
      assertEquals(body.hash, hash);
    } finally {
      m.restore();
    }
  },
);
Deno.test(
  "tampered bytes never reach canonical storage or database authorization",
  async () => {
    const bytes = file.slice();
    bytes[10] = 0;
    const m = mock({ bytes });
    try {
      const response = await handleRequest(
        request({ action: "complete", intentId }),
      );
      assertEquals(response.status, 400);
      assertEquals(m.calls.filter((c) => c.method === "PUT").length, 0);
      assertEquals(
        m.calls.filter((c) => c.url.endsWith("complete_book_upload")).length,
        0,
      );
    } finally {
      m.restore();
    }
  },
);
Deno.test(
  "validation precedes conditional canonical PUT and authorization",
  async () => {
    const m = mock();
    try {
      const response = await handleRequest(
        request({ action: "complete", intentId }),
      );
      assertEquals(response.status, 200);
      const write = m.calls.find((c) => c.method === "PUT")!;
      assert(write.url.includes(`/books/${hash}.pdf`));
      assertEquals(write.headers.get("If-None-Match"), "*");
      assert(
        m.calls.findIndex((c) => c === write) <
          m.calls.findIndex((c) => c.url.endsWith("complete_book_upload")),
      );
    } finally {
      m.restore();
    }
  },
);
Deno.test("complete accepts a valid EPUB with mimetype after the first ZIP member", async () => {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", '<container><rootfile full-path="OPS/book.opf"/></container>');
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("OPS/book.opf", '<package version="3.0"><metadata/><manifest/><spine/></package>');
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  const copy = new Uint8Array(new ArrayBuffer(bytes.length)); copy.set(bytes);
  const epubHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer))]
    .map(value => value.toString(16).padStart(2, "0")).join("");
  const m = mock({ bytes, hash: epubHash, format: "epub" });
  try {
    const response = await handleRequest(request({ action: "complete", intentId }));
    assertEquals(response.status, 200);
    const write = m.calls.find(call => call.method === "PUT");
    assert(write?.url.includes(`/books/${epubHash}.epub`));
  } finally { m.restore(); }
});

Deno.test("prepare distinguishes storage and technical upload limits without signing R2", async () => {
  for (const reason of ["storage_limit", "pending_upload_limit", "upload_rate_limited"] as const) {
    const m=mock({quotaReason:reason});
    try {
      const response=await handleRequest(request({action:"prepare",hash,format:"pdf",size:file.length,title:"Quota"}));
      assertEquals(response.status,429);
      assertEquals(await response.json(),{code:reason});
      assertEquals(m.calls.filter(call=>call.url.includes("r2.cloudflarestorage.com")).length,0);
    } finally { m.restore(); }
  }
});
Deno.test("remove derives ownership from JWT, cancels staging and never deletes a shared canonical object", async () => {
  const m = mock();
  try {
    const response = await handleRequest(request({ action: "remove", bookId: book, userId: "victim" }));
    assertEquals(response.status, 200);
    assertEquals((await response.json()).usage.used_books, 13);
    assert(m.calls.some(call => call.method === "DELETE" && call.url.includes(`/staging/${owner}/`)));
    assert(!m.calls.some(call => call.method === "DELETE" && call.url.includes("/books/")));
  } finally { m.restore(); }
  const denied = mock({ removeDenied: true });
  try { assertEquals((await handleRequest(request({ action: "remove", bookId: book }))).status, 403); }
  finally { denied.restore(); }
});
