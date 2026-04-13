const { subtle } = require("crypto").webcrypto;

async function testPbkdf2() {
  const encoder = new TextEncoder();
  const password = "password123";
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const keyMaterial = await subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  for (let iters of [100000, 10000, 1000, 100]) {
    console.log(`Testing ${iters} iterations...`);
    const start = Date.now();
    try {
      await subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: salt,
          iterations: iters,
          hash: { name: "SHA-256" },
        },
        keyMaterial,
        32 * 8,
      );
      console.log(`Success ${iters} iterations in ${Date.now() - start}ms`);
    } catch (err) {
      console.error(`Failed ${iters} iterations:`, err);
    }
  }
}
testPbkdf2();
