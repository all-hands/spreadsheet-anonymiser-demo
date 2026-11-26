use anonymiser_core::*;

const SALT: [u8; 32] = [1u8; 32];
const MASTER: [u8; 64] = [7u8; 64];

fn raw_root() -> RootKey {
    derive_root_key_raw(&MASTER, &SALT)
}

fn col_key() -> [u8; 64] {
    column_key(&raw_root(), &SALT, "email").unwrap()
}

#[test]
fn argon2id_root_keys_are_pinned() {
    let tiny = Profile {
        iters: 1,
        memory_kb: 64,
        threads: 1,
    };
    let root = derive_root_key(b"correct horse battery staple", &SALT, tiny).unwrap();
    assert_eq!(
        hex::encode(root.as_bytes()),
        concat!(
            "344236fda61b99e385cc2140774647f830e537ed51a27f51fbd65898ec2da9a44d698cccf9c7297c",
            "2dd86254013fb156e30be971043fb67e7d09c26547486665",
        )
    );
    let browser = derive_root_key(b"pw", &SALT, Profile::browser()).unwrap();
    assert_eq!(
        hex::encode(browser.as_bytes()),
        concat!(
            "7008fd53efd59d98e3f7db9261370540924f2254ddf2661d31e8f6bb9cfec0cccb055367832167c4",
            "5d5b5ba65de0ade628e51e3ac6b31d93fc7c06e9f5999395",
        )
    );
}

#[test]
fn hkdf_key_schedule_is_pinned() {
    assert_eq!(
        hex::encode(raw_root().as_bytes()),
        concat!(
            "ce3a18ef76b11de245cc7bbc66b60fb2a220ad92681e335ad390a9d3a80b2861e01649611d3387bf",
            "8ed7543e8b197e1c1fd5380e7e7bc89cbea7ac2f36e046ad",
        )
    );
    assert_eq!(
        hex::encode(col_key()),
        concat!(
            "d4c00b5e3707a3ac9f0b6dd644c7f508670287b04443bded0f0cb03e6995f00ce535d7be4581c0b7",
            "e9fcefec9f76bf2b9bcb80897f5eec7db666ecc66f9eb543",
        )
    );
    let scoped = column_key_scoped(&raw_root(), &SALT, "students", "email").unwrap();
    assert_eq!(
        hex::encode(scoped),
        concat!(
            "573c96ad21598bd890969630d8687da7619c7b8edcba744ca6b849c5a098b7063a1b90fac189f9dd",
            "b32c7a511491496794d9520985aa89853e9045f2ccaaec91",
        )
    );
    assert_eq!(
        hex::encode(mapping_key(&raw_root(), "students")),
        "8a17d9dc22d5606a5a3a86f6757c5bb89891aa986492c4eba4c9413e8580132f"
    );
}

#[test]
fn blake2_token_and_fingerprint_are_pinned() {
    assert_eq!(
        hash_cell("x@y.com", &col_key(), 16).unwrap(),
        "2cb3dd53b88917a99e09377853d87f2c"
    );
    assert_eq!(key_fingerprint(&MASTER), "97e7e4f2d1738f79");
    assert_eq!(
        legacy_hmac_sha256("student01", b"secret-key"),
        "f1d705e75759fb92"
    );
}

#[test]
fn enc_v1_cell_is_pinned() {
    const CELL: &str = "enc:v1:AgICAgICAgICAgIClpDGkJCnK5GTmsrKV8+aHbumPVfW8yueWw==";
    assert_eq!(
        encrypt_cell("student01", &col_key(), &[2u8; 12]).unwrap(),
        CELL
    );
    assert_eq!(decrypt_cell(CELL, &col_key()).unwrap(), "student01");
}

#[test]
fn kyber_v1_cell_is_pinned() {
    const CELL: &str = concat!(
        "kyber:v1:wK61MrEkmB1I1eq26KyPcJt3mNy1e/xXlQzCksQwQlVrbtpTZcLqCGtvXkJYsJyNp/JP58Y",
        "0B15gwGvCjeGW4sDBkYdsgrI+vwihkahGP0SPMAmv5QWYP/reXAsTGTtptkXTVjWCsUseicKXqLfv1Au",
        "2SqIOYv1U69Hiy3TlEdUMEPOqAqCimH2FMMEf5283+H90Rz3uDvOyH5aI5TzRdhi/dMOWX1CgQfPhaZA",
        "GTXnaqDz0sFjfgjIeonEC6sUZqSDNjTRIP84RGt7pNlluWJeKcteqrF3ux0jwQY45rTiAbkuQflEJKhT",
        "zzKcGrHvkRjTIldz/mpgyrTEI8mxagmh36sPLlW6FUvZJAqCvBaNF6iFrv8rpsS455Duc9KKcVgtTXbx",
        "6tdTdRT4ORWXSpZhWZQTWeK3z9M4yW2zO5h0vCK4+GMxVtisNM2qci988FdEYPH50YKfwRHULX+HdcxM",
        "CsyQX+khCIDJclVO51HN/e50g31/ghsKLdEQj9pNjKLQvGeYtifdLm4pOzH9n62ncihEgpYBKmdAsEtH",
        "dCir/DiDM+DKD2K9fuj93514xjZZpiUMz//z8fc+kt77SYTCU/xcFn2/myxPT2gyT6FESBxegT0RwroY",
        "0uqycGJNdHrkwaySh9VKJgA3yqC1ubuIoEhjs7cauHfcKi2A4LePGiTXTwsAjnQ7UZO/mX0tAu6mg/Yu",
        "+WLQQ68+SV828B2/81S0latO95o36/GG98Pqn3kiWFT7rasfOny+Drp4Sy7nEULthipp2fNfHBwKcldW",
        "iY9JLAKvQLuOy3D+EneG/9Bil++APeytNqaFUDBUsGrp/PiuWLtXSOg4Q6C74XoRfLMTRClERPWgcbIe",
        "iG6BdcnK3TcmT1ay7j3BBNed/vFbfXA8SH+FgTws7gyEggV62Vr57blWI2l5lcNM86xyylDQMGhz0kew",
        "mgzIQX6hSeEHXSqSz9BJaEldbJgNQVFgKaaOLaQFghjUs3mND0Za5A+qQSao8cOx/x3cZ3Bf9RV3rVbS",
        "C+2ZbUA80sfsOHq5jmaSixybMlXPyv+gSyGIwPeDuJ4JIAqyNfj9Q3XFPG8Gf6mhld0HPYS1fojqhbP2",
        "2PJ07iN9126Rp9YTElzQlMLMA+FWbVOn9mqX0AurEsGt/6Vy4DsyONV1COPyc64QWWAEzkXGORnDRy/G",
        "iARwAoG3j551bJv4r9w59Lohc8W4DRpJDqh0Gz32MUxHx1VMcSAznCfkpWuAUiMW+lkprn4AtF2nGbgR",
        "f70fHyxXdliHhamzqgdpTUelryyCzPvvDydu6fT4x/lMC6HYoqCaN+g8kuKybRUo7Cc3XoK76F5l/8pD",
        "KN0F5pasAcse6dWzUvMd2PP61OVjZnIgqqloFCTXjTUni8e77Dzwy+6vY7IAdYc6ChSGBA1edFcEWDWk",
        "/mZQVk8DRdFkIYkGHwcM9C9qCLIdoeysBXKxx0ZvPkA2OwIk/zj1P",
    );
    assert_eq!(kyber_encrypt_cell("student01", &col_key()).unwrap(), CELL);
    assert_eq!(kyber_decrypt_cell(CELL, &col_key()).unwrap(), "student01");
}

#[test]
fn legacy_cells_from_pinned_vectors_still_decrypt() {
    const ENC: &str =
        "enc:tB9LyLAYzMBtt9C8RGv0Zh19GscTPUjzNY95o9NQu1jnmR7Haf8R5UKriKI8KSq06V48dmc=";
    const QENC: &str = concat!(
        "qenc:AQ5ey/dYy5f44vA6OYymaNd8MrEsPw8f0FNReWbIgrwl47IFHn/Q0RtS0hCB5XJx2rDv0ocZzvD",
        "fyLeOO5/UDB3vG8me",
    );
    assert_eq!(
        legacy_decrypt_cell(ENC, b"secret-key").unwrap(),
        "student01"
    );
    assert_eq!(
        legacy_decrypt_cell(QENC, b"secret-key").unwrap(),
        "student01"
    );
}

#[test]
fn mapping_row_from_pinned_vectors_still_opens() {
    let key = mapping_key(&raw_root(), "students");
    let nonce: [u8; MAPPING_NONCE_LEN] =
        hex::decode("25c0cd85be9b90d55aafd1a3d0f00279c7957690bba44ecf")
            .unwrap()
            .try_into()
            .unwrap();
    let ct =
        hex::decode("c86ab5423ff2a1bdb8d8d9951367e1b374cb1bd2e87f9252c46bf998d6a789e0a3").unwrap();
    assert_eq!(
        open_mapping_value(&key, "students", "g", "tok", &nonce, &ct).unwrap(),
        "alice@example.com"
    );
}
