import test from "node:test";
import assert from "node:assert/strict";
import {
  assetTypeOf,
  buildSep7PayUri,
  coversAmount,
  explorerAccountUrl,
  explorerTxUrl,
  formatBs,
  formatChargeMonth,
  formatRate,
  formatUsdc,
  fromStroops,
  isPublicChargeCode,
  missingAmount,
  parseChargeMonth,
  shortAddress,
  toStroops,
} from "../.cache/payments-tests/utils/stellar-pay.js";

const TREASURY = "GCV2O6LDJUNPSRBWMUHIPJOSRETVTVEYSAZLU5YKJU24EXFZXZAA63MD";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

test("convierte montos de Stellar a stroops y de vuelta sin flotantes", () => {
  assert.equal(toStroops("13.1"), 131000000n);
  assert.equal(toStroops("13.1000000"), 131000000n);
  assert.equal(toStroops("0.0000001"), 1n);
  assert.equal(fromStroops(131000000n), "13.1000000");
  assert.equal(fromStroops(1n), "0.0000001");
  assert.equal(fromStroops(0n), "0.0000000");
  for (const amount of ["0.0100000", "16.0400000", "104.7300000"]) {
    assert.equal(fromStroops(toStroops(amount)), amount);
  }
});

test("rechaza textos que no son un monto de Stellar", () => {
  for (const bad of ["", "-1", "1.", ".5", "1.00000001", "1,5", "abc", "1e3"]) {
    assert.throws(() => toStroops(bad), /inválido/);
  }
  assert.throws(() => toStroops(13.1), /inválido/);
});

test("calcula lo que falta para cubrir un cobro", () => {
  assert.equal(missingAmount("13.1000000", "0.8000000"), "12.3000000");
  assert.equal(missingAmount("13.1000000", "13.1000000"), "0.0000000");
  assert.equal(missingAmount("13.1000000", "50"), "0.0000000");
  assert.equal(missingAmount("13.1000000", null), "13.1000000");
  assert.equal(missingAmount("13.1000000", "no es un saldo"), "13.1000000");
});

test("un saldo un stroop por debajo no cubre el cobro", () => {
  assert.equal(coversAmount("13.1000000", "13.1000000"), true);
  assert.equal(coversAmount("13.1000000", "13.0999999"), false);
  assert.equal(coversAmount("13.1000000", null), false);
  // Con flotantes, 0.1 + 0.2 no es 0.3; con stroops sí alcanza.
  assert.equal(coversAmount("0.3000000", fromStroops(toStroops("0.1") + toStroops("0.2"))), true);
});

test("formatea bolivianos como es-BO", () => {
  assert.equal(formatBs(155), "Bs 155,00");
  assert.equal(formatBs(1234.5), "Bs 1.234,50");
  assert.equal(formatBs(1234567.891), "Bs 1.234.567,89");
  assert.equal(formatBs(0.5), "Bs 0,50");
  assert.equal(formatBs(-12), "Bs -12,00");
});

test("formatea USDC con dos decimales, o más si el monto los tiene", () => {
  assert.equal(formatUsdc("13.1000000"), "13,10");
  assert.equal(formatUsdc("104.7300000"), "104,73");
  assert.equal(formatUsdc("1234.0000000"), "1.234,00");
  assert.equal(formatUsdc("0.1234567"), "0,1234567");
  assert.equal(formatUsdc("6.5500000"), "6,55");
  assert.equal(formatUsdc("20"), "20,00");
  assert.equal(formatUsdc("no es un monto"), "no es un monto");
});

test("formatea el tipo de cambio sin ceros de más", () => {
  assert.equal(formatRate(11.84), "11,84");
  assert.equal(formatRate(6.96), "6,96");
  assert.equal(formatRate(7), "7,00");
  assert.equal(formatRate(11.8456), "11,8456");
});

test("abrevia una dirección de Stellar", () => {
  assert.equal(shortAddress(TREASURY), "GCV2…63MD");
  assert.equal(shortAddress(TREASURY, 6), "GCV2O6…AA63MD");
  assert.equal(shortAddress("GABC"), "GABC");
});

test("arma el URI de pago SEP-7 con destino, monto, activo y memo", () => {
  const uri = buildSep7PayUri({
    destination: TREASURY,
    amount: "13.1000000",
    assetCode: "USDC",
    assetIssuer: USDC_ISSUER,
    memo: "AQT-CPPQBFRW5E",
  });

  assert.ok(uri.startsWith("web+stellar:pay?"));
  const params = new URLSearchParams(uri.slice("web+stellar:pay?".length));
  assert.equal(params.get("destination"), TREASURY);
  assert.equal(params.get("amount"), "13.1000000");
  assert.equal(params.get("asset_code"), "USDC");
  assert.equal(params.get("asset_issuer"), USDC_ISSUER);
  assert.equal(params.get("memo"), "AQT-CPPQBFRW5E");
  assert.equal(params.get("memo_type"), "MEMO_TEXT");
});

test("codifica un memo con espacios en el URI de pago", () => {
  const uri = buildSep7PayUri({
    destination: TREASURY,
    amount: "1",
    assetCode: "USDC",
    assetIssuer: USDC_ISSUER,
    memo: "Retiro de prueba",
  });

  const query = uri.split("?")[1];
  assert.ok(query.includes("memo=Retiro%20de%20prueba"));
  assert.ok(!query.includes("+"));
});

test("enlaza al explorador de la red que corresponde", () => {
  assert.equal(
    explorerAccountUrl("testnet", TREASURY),
    `https://stellar.expert/explorer/testnet/account/${TREASURY}`,
  );
  assert.equal(explorerTxUrl("public", "abc123"), "https://stellar.expert/explorer/public/tx/abc123");
});

test("elige el tipo de activo por el largo del código", () => {
  assert.equal(assetTypeOf("USDC"), "credit_alphanum4");
  assert.equal(assetTypeOf("TESTUSD"), "credit_alphanum12");
});

test("reconoce el código del enlace de pago", () => {
  assert.equal(isPublicChargeCode("7f3k2m9qxz7f3k2m9qxz"), true);
  assert.equal(isPublicChargeCode("7F3K2M9QXZ7F3K2M9QXZ"), false);
  assert.equal(isPublicChargeCode("demo"), false);
  assert.equal(isPublicChargeCode("7f3k2m9qxz7f3k2m9qxo"), false);
  assert.equal(isPublicChargeCode("../../etc/passwd....."), false);
});

test("lee y nombra el mes de un cobro", () => {
  assert.deepEqual(parseChargeMonth("2026-10"), { year: 2026, month: 10 });
  assert.equal(parseChargeMonth("2026-13"), null);
  assert.equal(parseChargeMonth("octubre"), null);
  assert.equal(formatChargeMonth("2026-10"), "octubre de 2026");
  assert.equal(formatChargeMonth("2026-01"), "enero de 2026");
  assert.equal(formatChargeMonth("sin formato"), "sin formato");
});
