# E2E Encryption Strategy for Asius Connect

## Executive Summary

This document outlines a comprehensive end-to-end encryption strategy for the Asius Connect platform. The goal is to ensure that user driving data remains private and only accessible to authorized parties, while still enabling essential server-side processing for features like GPS extraction, event parsing, and thumbnail generation.

---

## Current Architecture Overview

```
Device → Upload → MiniKeyValue (plaintext) → Processing → SQLite (plaintext)
                                                              ↓
                                              Web Client ← API ← Database
```

**Current Security:**
- Device authentication: RSA public/private key pairs
- User authentication: JWT tokens (Google OAuth)
- Access control: Permission-based (owner/read_access)
- Transport: HTTPS/WSS
- Storage: Plaintext

---

## Threat Model

### What We're Protecting Against:
1. **Server breach** - Attacker gains access to MiniKeyValue storage
2. **Database breach** - Attacker gains access to SQLite database
3. **Insider threat** - Malicious operator with server access
4. **Data subpoena** - Legal requests for user data (ability to claim "we can't decrypt")
5. **Man-in-the-middle** - Already mitigated by TLS

### What We're NOT Protecting Against:
1. **Compromised device** - If device is compromised, attacker has raw data
2. **Compromised user endpoint** - If user's browser is compromised
3. **Traffic analysis** - Metadata like "user uploaded X bytes at time Y"

---

## Proposed Architecture

### Key Hierarchy

```
                    ┌─────────────────────┐
                    │   Master User Key   │
                    │  (derived from pwd  │
                    │   or stored secure) │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │  Device Key     │ │  Device Key     │ │  Device Key     │
    │  (per device)   │ │  (per device)   │ │  (per device)   │
    └────────┬────────┘ └────────┬────────┘ └────────┬────────┘
             │                   │                   │
             ▼                   ▼                   ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │  Route Keys     │ │  Route Keys     │ │  Route Keys     │
    │  (per route)    │ │  (per route)    │ │  (per route)    │
    └─────────────────┘ └─────────────────┘ └─────────────────┘
```

### Key Types

| Key Type | Purpose | Storage | Who Has Access |
|----------|---------|---------|----------------|
| User Master Key (UMK) | Wraps all user's device keys | Client-side only (or password-derived) | User only |
| Device Encryption Key (DEK) | Encrypts all data from one device | Device + wrapped by UMK | Device, User |
| Route Key (RK) | Encrypts one route's data | Wrapped by DEK | Device, User, Shared users |
| Processing Key (PK) | Temporary key for server processing | Ephemeral, derived per-upload | Server (temporarily) |
| Public Share Key (PSK) | Allows public access to route | Derived from RK, can be shared | Anyone with link |

---

## Encryption Schemes

### 1. File Encryption (Raw Data)

**Algorithm:** XChaCha20-Poly1305 (or AES-256-GCM)

```
Encrypted File Format:
┌──────────────────────────────────────────────────────────┐
│ Version (1 byte) │ Nonce (24 bytes) │ Ciphertext │ Tag   │
└──────────────────────────────────────────────────────────┘
```

**Files encrypted:**
- `qlog.zst` - Driving logs
- `qcamera.ts` - Video
- `fcamera.hevc`, `dcamera.hevc`, `ecamera.hevc` - Camera footage
- `rlog.zst` - Regular logs
- Boot logs, crash logs

### 2. Metadata Encryption (Database)

**Strategy: Encrypted columns in SQLite**

```sql
-- Segments table with encrypted sensitive fields
segments (
  dongle_id,           -- plaintext (needed for queries)
  route_id,            -- plaintext (needed for queries)
  segment,             -- plaintext (needed for queries)

  -- Encrypted with Route Key
  start_lat_encrypted, -- AES-GCM encrypted
  start_lng_encrypted,
  end_lat_encrypted,
  end_lng_encrypted,
  start_time_encrypted,
  end_time_encrypted,
  distance_encrypted,

  -- Plaintext metadata (non-sensitive)
  version,             -- software version
  platform,            -- device platform
  create_time          -- when segment was created
)
```

### 3. Key Wrapping

**User Master Key → Device Key wrapping:**
```
wrapped_dek = AES-KW(UMK, DEK)
```

**Device Key → Route Key wrapping:**
```
wrapped_rk = AES-KW(DEK, RK)
```

---

## Data Flow: Upload with Encryption

### Phase 1: Device-Side Encryption

```
Device generates route:
    │
    ├─► Generate Route Key (RK) = random 256 bits
    │
    ├─► For each file (qlog, qcamera, etc.):
    │       encrypted_file = XChaCha20-Poly1305(RK, file)
    │       Upload encrypted_file
    │
    ├─► Generate Processing Key (PK):
    │       PK = HKDF(RK, "processing", route_id)
    │
    ├─► Encrypt RK for server processing:
    │       wrapped_pk = RSA-OAEP(server_public_key, PK)
    │       (server can derive RK from PK for processing only)
    │
    └─► Upload metadata:
            - wrapped_pk (for server processing)
            - wrapped_rk_for_user = AES-KW(DEK, RK)
```

### Phase 2: Server-Side Processing (Temporary Decryption)

```
Server receives upload:
    │
    ├─► Decrypt PK using server private key
    │       PK = RSA-OAEP-Decrypt(server_private_key, wrapped_pk)
    │
    ├─► Derive file decryption key from PK
    │       file_key = HKDF(PK, "files", route_id)
    │
    ├─► In secure processing context:
    │       ┌─────────────────────────────────────┐
    │       │  Decrypt qlog.zst                   │
    │       │  Parse and extract:                 │
    │       │    - GPS coordinates                │
    │       │    - Events                         │
    │       │    - Metadata                       │
    │       │  Encrypt extracted data with RK    │
    │       │  Generate sprite from qcamera       │
    │       │  Encrypt sprite with RK            │
    │       │  SECURELY ERASE PK FROM MEMORY     │
    │       └─────────────────────────────────────┘
    │
    ├─► Store encrypted extracted data:
    │       - coords.json.enc
    │       - events.json.enc
    │       - sprite.jpg.enc
    │
    └─► Update database with encrypted metadata
```

### Phase 3: User Access

```
User requests route:
    │
    ├─► Client fetches wrapped_rk_for_user
    │
    ├─► Client decrypts with their DEK:
    │       RK = AES-KW-Unwrap(DEK, wrapped_rk_for_user)
    │
    ├─► Client fetches encrypted files
    │
    └─► Client decrypts locally:
            coords = XChaCha20-Poly1305-Decrypt(RK, coords.json.enc)
            events = XChaCha20-Poly1305-Decrypt(RK, events.json.enc)
            sprite = XChaCha20-Poly1305-Decrypt(RK, sprite.jpg.enc)
```

---

## Alternative: Minimal Server Processing

If you want to minimize server decryption exposure:

### Option A: Client-Side Processing

```
Device uploads encrypted files
    │
    ▼
Server stores encrypted blobs (no processing)
    │
    ▼
Client downloads encrypted files
    │
    ▼
Client decrypts and processes in browser:
    - Parse qlog in WebAssembly
    - Extract frames from video in browser
    - Generate thumbnails client-side
```

**Pros:** Server never sees plaintext
**Cons:** Worse UX, higher bandwidth, no server-side features (notifications, alerts)

### Option B: Trusted Compute / Enclave

```
Device uploads encrypted files
    │
    ▼
Server sends to trusted enclave (SGX/TrustZone/Nitro):
    - Enclave has processing key
    - Decrypts, processes, re-encrypts
    - Main server never sees plaintext
    │
    ▼
Encrypted results stored
```

**Pros:** Cryptographic guarantee server can't access data
**Cons:** Complex infrastructure, hardware requirements

---

## Public Routes

### Option 1: Public Share Key Derivation

```
User makes route public:
    │
    ├─► Derive Public Share Key:
    │       PSK = HKDF(RK, "public", route_id)
    │
    ├─► Re-encrypt public-safe data with PSK:
    │       - coords.json (GPS track)
    │       - events.json (drive events)
    │       - sprite.jpg (thumbnail)
    │       - qcamera.ts (if user chooses)
    │
    ├─► Store PSK in public_routes table
    │       OR embed in share URL
    │
    └─► Anyone with URL can decrypt public data
```

**Share URL format:**
```
https://comma.asius.ai/route/dongleId|routeId?key=base64(PSK)
```

### Option 2: Selective Unencryption

```
User makes route public:
    │
    ├─► Server decrypts selected files
    │       (using wrapped RK the server temporarily had)
    │
    ├─► Store unencrypted copies in public bucket
    │       - public/dongleId/routeId/coords.json
    │       - public/dongleId/routeId/sprite.jpg
    │
    └─► Original encrypted files remain in private storage
```

**Pros:** Simpler implementation
**Cons:** Server must retain ability to decrypt (defeats some E2E goals)

### Option 3: User-Controlled Public Key

```
User makes route public:
    │
    ├─► Client decrypts files locally
    │
    ├─► Client re-uploads unencrypted to public endpoint
    │
    └─► Server stores in public bucket (never had keys)
```

**Pros:** True E2E - server never has keys
**Cons:** Requires client to be online to make public

### Recommended: Option 1 (PSK Derivation)

This balances security with usability. The share link contains the key, so:
- Server never stores the public key
- Link itself grants access
- Revoking public access = deleting public re-encrypted copies

---

## Device Keys and User Tokens

### Device Key Management

```
Device Registration Flow:
    │
    ├─► Device generates:
    │       - RSA key pair (existing, for auth)
    │       - Device Encryption Key (DEK) = random 256 bits
    │
    ├─► Device stores DEK in secure storage (TPM/Keychain)
    │
    ├─► When user pairs device:
    │       ┌─────────────────────────────────────┐
    │       │  Device sends DEK encrypted with   │
    │       │  user's public key:                │
    │       │                                    │
    │       │  wrapped_dek = RSA-OAEP(           │
    │       │      user_public_key,              │
    │       │      DEK                           │
    │       │  )                                 │
    │       └─────────────────────────────────────┘
    │
    └─► Server stores wrapped_dek (can't decrypt it)
```

### User Key Management

**Option A: Password-Derived Key**
```
User sets encryption password (separate from login):
    │
    ├─► User Master Key = Argon2id(password, salt, params)
    │
    ├─► UMK used to unwrap device keys
    │
    └─► Password never sent to server
```

**Pros:** No key storage needed
**Cons:** Forgotten password = lost data

**Option B: Key Stored in Browser**
```
On first login:
    │
    ├─► Generate UMK = random 256 bits
    │
    ├─► Store in IndexedDB with Web Crypto API
    │       (marked as non-extractable)
    │
    └─► Optionally backup encrypted with recovery phrase
```

**Pros:** Better UX
**Cons:** Device-specific, need backup mechanism

**Option C: Hybrid (Recommended)**
```
On first login:
    │
    ├─► Generate UMK = random 256 bits
    │
    ├─► Store in IndexedDB
    │
    ├─► Generate recovery phrase (BIP39 mnemonic)
    │       recovery_key = PBKDF2(mnemonic)
    │
    ├─► Store wrapped UMK on server:
    │       wrapped_umk = AES-KW(recovery_key, UMK)
    │
    └─► User writes down recovery phrase
```

### Token Structure Changes

**Current JWT payload:**
```json
{
  "id": "user_id",
  "exp": 1234567890
}
```

**New JWT payload:**
```json
{
  "id": "user_id",
  "exp": 1234567890,
  "key_version": 1,
  "wrapped_dek_access": true
}
```

---

## Database Schema Changes

### New Tables

```sql
-- User encryption keys (wrapped, server can't decrypt)
CREATE TABLE user_keys (
    user_id TEXT PRIMARY KEY,
    wrapped_umk BLOB,           -- UMK wrapped with recovery key (server stores)
    umk_salt BLOB,              -- Salt for recovery key derivation
    key_version INTEGER,
    created_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Device encryption keys (wrapped with user keys)
CREATE TABLE device_keys (
    dongle_id TEXT,
    user_id TEXT,
    wrapped_dek BLOB,           -- DEK wrapped with user's UMK
    key_version INTEGER,
    created_at INTEGER,
    PRIMARY KEY (dongle_id, user_id),
    FOREIGN KEY (dongle_id) REFERENCES devices(dongle_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Route encryption keys (wrapped with device keys)
CREATE TABLE route_keys (
    dongle_id TEXT,
    route_id TEXT,
    wrapped_rk BLOB,            -- RK wrapped with DEK
    public_psk BLOB,            -- PSK if route is public (optional)
    key_version INTEGER,
    created_at INTEGER,
    PRIMARY KEY (dongle_id, route_id),
    FOREIGN KEY (dongle_id, route_id) REFERENCES routes(dongle_id, route_id)
);

-- Server processing keys (ephemeral, for audit)
CREATE TABLE processing_log (
    id INTEGER PRIMARY KEY,
    dongle_id TEXT,
    route_id TEXT,
    processed_at INTEGER,
    files_processed TEXT,       -- JSON array of filenames
    key_destroyed_at INTEGER    -- When we erased the processing key
);
```

### Modified Tables

```sql
-- Segments: encrypted sensitive fields
ALTER TABLE segments ADD COLUMN encrypted_data BLOB;
-- encrypted_data contains JSON encrypted with Route Key:
-- {
--   "start_lat": ...,
--   "start_lng": ...,
--   "end_lat": ...,
--   "end_lng": ...,
--   "start_time": ...,
--   "end_time": ...,
--   "distance": ...
-- }

-- Routes: add key references
ALTER TABLE routes ADD COLUMN has_encryption BOOLEAN DEFAULT FALSE;
ALTER TABLE routes ADD COLUMN encryption_version INTEGER DEFAULT 1;
```

---

## API Changes

### New Endpoints

```typescript
// Key management
POST /v2/keys/init
  // Initialize user encryption (generate UMK, return recovery phrase)
  Response: { recovery_phrase: string, key_version: number }

POST /v2/keys/recover
  // Recover UMK using recovery phrase
  Body: { recovery_phrase: string }
  Response: { wrapped_umk: string }

GET /v2/keys/device/{dongleId}
  // Get wrapped DEK for device
  Response: { wrapped_dek: string, key_version: number }

POST /v2/keys/device/{dongleId}
  // Store wrapped DEK after pairing
  Body: { wrapped_dek: string }

// Route key management
GET /v2/route/{routeName}/key
  // Get wrapped route key
  Response: { wrapped_rk: string }

POST /v2/route/{routeName}/makePublic
  // Make route public with derived PSK
  Body: { psk: string }  // Client-derived, for verification

// Encrypted data access
GET /v2/route/{routeName}/encrypted
  // Get encrypted route metadata
  Response: { encrypted_data: string, nonce: string }
```

### Modified Endpoints

```typescript
// Upload now accepts encrypted files
PUT /connectdata/{key}
  Headers:
    X-Encryption-Version: 1
    X-Wrapped-Processing-Key: base64(...)  // For server processing
  Body: encrypted file data

// File responses now include encryption metadata
GET /connectdata/{key}
  Response Headers:
    X-Encrypted: true
    X-Encryption-Version: 1
  Body: encrypted file data (client must decrypt)
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Add encryption schema to database
- [ ] Implement key generation utilities
- [ ] Add client-side crypto library (libsodium-wrappers or Web Crypto)
- [ ] Create key management API endpoints

### Phase 2: Device Integration (Week 3-4)
- [ ] Modify device firmware to generate DEK
- [ ] Implement file encryption on device before upload
- [ ] Add processing key wrapping for server
- [ ] Update upload flow to include encryption headers

### Phase 3: Server Processing (Week 5-6)
- [ ] Create secure processing context
- [ ] Implement temporary key handling with secure erasure
- [ ] Modify qlog/qcamera processing to decrypt→process→re-encrypt
- [ ] Add processing audit logging

### Phase 4: Client Decryption (Week 7-8)
- [ ] Implement client-side key unwrapping
- [ ] Add decryption layer to data fetching
- [ ] Update UI to handle encrypted data
- [ ] Implement key backup/recovery flow

### Phase 5: Public Routes (Week 9-10)
- [ ] Implement PSK derivation
- [ ] Add public share key to URLs
- [ ] Create public data re-encryption flow
- [ ] Update share functionality

### Phase 6: Migration (Week 11-12)
- [ ] Create migration path for existing unencrypted data
- [ ] Offer opt-in encryption for existing users
- [ ] Eventually make encryption default/required

---

## Security Considerations

### Key Rotation

```
User requests key rotation:
    │
    ├─► Generate new UMK'
    │
    ├─► For each device:
    │       Re-wrap DEK with new UMK'
    │       Update device_keys table
    │
    └─► Old UMK can be destroyed
```

Route keys don't need rotation (they're per-route and wrapped by DEK).

### Secure Erasure

Server MUST securely erase processing keys after use:

```typescript
// Example secure erasure in TypeScript/Bun
function secureErase(buffer: Uint8Array) {
  crypto.getRandomValues(buffer);  // Overwrite with random
  buffer.fill(0);                  // Then zero
  // Note: JS doesn't guarantee memory erasure,
  // consider native module for production
}
```

For true security, consider:
- Using Rust/C native module with explicit memory zeroing
- Running processing in separate isolated process
- Using hardware security modules (HSM) for key operations

### Audit Logging

All key operations should be logged:
- Key generation
- Key wrapping/unwrapping
- Processing key usage and destruction
- Public key derivation

```typescript
interface KeyAuditLog {
  timestamp: number;
  operation: 'generate' | 'wrap' | 'unwrap' | 'process' | 'destroy' | 'derive_public';
  user_id?: string;
  device_id?: string;
  route_id?: string;
  success: boolean;
  error?: string;
}
```

---

## Tradeoffs and Decisions

### Decision 1: Server Processing vs Pure E2E

**Chosen:** Server has temporary processing access

**Rationale:**
- Enables push notifications for drive events
- Enables server-side search/filtering
- Better UX (instant thumbnails, no client processing)
- Processing keys are ephemeral and logged

**Alternative:** Pure client-side processing would be more secure but significantly worse UX

### Decision 2: Per-Route vs Per-File Keys

**Chosen:** Per-route keys

**Rationale:**
- Simpler key management
- Routes are the natural sharing unit
- Reduces key storage overhead

**Alternative:** Per-file keys would allow finer-grained sharing but adds complexity

### Decision 3: Public Route Handling

**Chosen:** PSK derivation with re-encryption

**Rationale:**
- Server never stores permanent access to private data
- Share link contains access (revocable by user)
- Balances convenience with security

**Alternative:** Full client-side public upload would be more secure but requires client to be online

---

## Open Questions

1. **Recovery phrase vs custodial backup?**
   - Self-custody: User responsible for recovery phrase
   - Custodial: Server stores recovery key (less secure but easier)
   - Hybrid: Optional custodial backup with extra password

2. **Backwards compatibility period?**
   - How long to support unencrypted routes?
   - Migration path for existing data?

3. **Device key sync between paired users?**
   - When user B is paired to user A's device
   - Does B get own copy of DEK wrapped with B's UMK?
   - Or does B always decrypt via A's shared key?

4. **Processing key exposure window?**
   - How to minimize time server holds processing key?
   - Should processing be async (store encrypted, process later)?

5. **Encryption for metadata queries?**
   - Can server query encrypted lat/lng for geofencing?
   - Would need searchable encryption or client-side filtering

---

## Appendix A: Cryptographic Primitives

| Purpose | Algorithm | Key Size | Notes |
|---------|-----------|----------|-------|
| File encryption | XChaCha20-Poly1305 | 256-bit | Fast, AEAD, large nonce |
| Key wrapping | AES-256-KW | 256-bit | Standard key wrap |
| Key derivation | HKDF-SHA256 | - | For deriving sub-keys |
| Password KDF | Argon2id | - | Memory-hard, GPU-resistant |
| Asymmetric wrap | RSA-OAEP-SHA256 | 2048-bit | For processing key to server |
| Signatures | Ed25519 | 256-bit | For key authenticity |

## Appendix B: Library Recommendations

**JavaScript/Browser:**
- `libsodium-wrappers` - Full crypto suite, WebAssembly
- `@noble/ciphers` - Audited, pure JS
- Web Crypto API - Browser native (limited algorithms)

**Device (C++/Python):**
- libsodium - Reference implementation
- OpenSSL - Widely available

**Server (Bun/Node):**
- `libsodium-wrappers` - Same as client
- Node.js crypto module - Native bindings
- `@noble/ciphers` - Pure JS fallback

## Appendix C: Example Encrypted File Header

```
Byte offset | Size | Field
-----------+------+------------------
0          | 1    | Version (0x01)
1          | 1    | Algorithm (0x01 = XChaCha20-Poly1305)
2          | 24   | Nonce
26         | 4    | Original size (uint32 LE)
30         | *    | Ciphertext
*-16       | 16   | Auth tag
```

---

## Summary

This E2E encryption strategy provides:

1. **Data privacy** - Raw driving data encrypted at rest
2. **Minimal server exposure** - Processing keys are ephemeral
3. **User control** - Users hold master keys
4. **Shareability** - Public routes via derived keys
5. **Audit trail** - All key operations logged
6. **Gradual rollout** - Can coexist with unencrypted data during migration

The key insight is that **true E2E for a platform like this requires the server to have temporary processing access** to provide features users expect (thumbnails, GPS tracks, notifications). The security comes from:
- Making that access ephemeral
- Logging all access
- Giving users the master keys
- Secure erasure of processing keys

This is similar to how Signal handles server-side features while maintaining E2E encryption.
