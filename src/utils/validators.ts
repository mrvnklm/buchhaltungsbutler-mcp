import { z } from "zod";

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const dateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    "DateTime must be YYYY-MM-DD HH:MM:SS"
  );

export const currencySchema = z.enum([
  "AED","AUD","BGN","BRL","CAD","CHF","CNY","COP","CYP","CZK",
  "DKK","EUR","GBP","HKD","HRK","HUF","IDR","ILS","INR","ISK",
  "JPY","KRW","LTL","LVL","MTL","MXN","MYR","NOK","NZD","PEN",
  "PHP","PLN","QAR","ROL","RON","RSD","RUB","SEK","SGD","SIT",
  "SKK","THB","TRL","TRY","UAH","USD","VND","ZAR",
]);

export const receiptTypeSchema = z.enum([
  "invoice inbound",
  "invoice outbound",
  "credit inbound",
  "credit outbound",
]);

export const vatCodeSchema = z.enum([
  "0_none",
  "19_vat",
  "7_vat",
  "19_pre",
  "7_pre",
  "19_both_1",
  "19_both_2",
  "7_both",
  "19_both_1_no_pre",
  "19_both_2_no_pre",
  "7_both_no_pre",
  "19_pre_app",
  "7_pre_app",
  "19_both_app_1",
  "19_both_app_2",
  "7_both_app",
  // §13b reverse-charge sub-variants (EU vs. non-EU counterparty, with/without
  // Vorsteuerabzug) confirmed present in the live BuchhaltungsButler API spec
  // (webapp.buchhaltungsbutler.de/api/v1) but previously missing here, which
  // rejected otherwise-valid vat codes before the request ever reached the API.
  "19_both_506",
  "19_both_6506",
  "19_both_511",
  "19_both_6511",
  "19_both_6501",
  "19_both_app_506",
  "19_both_app_511",
]);

export const eInvoiceTaxTypeSchema = z.enum(["S", "Z", "AE", "K", "G", "E"]);

export const listDirectionSchema = z.enum(["inbound", "outbound"]);

export const invoiceTypeSchema = z.enum(["invoice", "credit", "offer"]);

export const accountTypeSchema = z.enum(["cash", "bank/institution", "other"]);

export const showPricesTypeSchema = z.enum(["net", "gross"]);
