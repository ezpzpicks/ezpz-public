import { constants, publicEncrypt } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ONE_TIME_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAjOS2AjYBd649wxF+Fha6
rPSa749iIRmzlUfyZV/+kdEdn/6wyUpiJD5l5B3FQy5ka30WpHdVYOfIE9Lu5mdM
P/HLrUcto17zJ3CGzlWbcDeox5Vg8ty5FgmE5ll05QndYl2HWkUCih+7whpPuRAu
5lePpN8FlSv+929f+Uhzqpj1bLclYJVkXz51pW8KBPnjK9CoxVXL5Teh5ujW5nwk
OkpXZ97uxxKmO6XuFfb3v5NPEc4Sw6JUNGFMEopC2khTGuTLp60WDBNjNwYWZSKd
OAdtZ6komCG4XssU63zbpjXRhJvkncWq4Em/1O8Afjasgisb+MzF3eVAwP2WfunI
9dZZPEHmS+uInE/iOi96ElUr/mZW8ODZ6YuF0gytLRoLJo3r2aQqcZ63rlzzFzjM
j2MvXCtaFDembv+16rIiqcuHlYHSivBQNtuJ9MqR9waok8Qe54Nx08P8re4lbMG2
sddx98eX/OyOwAGByFsYmjM4gv9yWTeEt7u2CThqxfVipQJmqlqW7wfYTx7A+uVY
a3eQvlK7v10OabhUtnUOhK5l7tKHCBbi1ZfycztKdHQ2WbNol5GTV6ytG6l+VVvv
BwwPWnLaoNdmpiqLuVxU3MsKvlrXoB8mRkYvJlryi9/QOqvYix5jfOQOeK3tRCHF
e4JusIZqXXJNGerruhUS8UsCAwEAAQ==
-----END PUBLIC KEY-----`;

function readFirst(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

export async function GET() {
  const token = readFirst(
    "turso_TURSO_AUTH_TOKEN",
    "TURSO_AUTH_TOKEN",
    "TURSO_DATABASE_AUTH_TOKEN",
  );

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Turso auth token is unavailable in this deployment." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const encrypted = publicEncrypt(
    {
      key: ONE_TIME_PUBLIC_KEY,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(token, "utf8"),
  );

  return NextResponse.json(
    {
      ok: true,
      ciphertext: encrypted.toString("base64"),
      tokenLength: token.length,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
