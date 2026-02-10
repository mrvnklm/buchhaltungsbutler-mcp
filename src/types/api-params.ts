// Receipt parameters
export interface ListReceiptsParams {
  list_direction: "inbound" | "outbound";
  payment_status?: "paid" | "unpaid";
  counterparty?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
  order?: Record<string, "ASC" | "DESC">;
  include_offers?: boolean;
  deleted?: boolean;
  invoicenumber?: string;
  due_date?: string;
}

export interface CreateReceiptParams {
  type: string;
  counterparty: string;
  invoice_number: string;
  date: string;
  amount: number;
  currency: string;
  vat_rate?: number;
  account?: number;
  creditor_debtor?: number;
  payment_reference?: string;
  date_delivery?: string;
  date_payment_due?: string;
  link_to_receipt_id_by_customer?: number;
}

export interface UploadReceiptParams {
  file: string;
  type: string;
  file_name?: string;
  account?: number;
  creditor_debtor?: number;
  counterparty?: string;
  invoice_number?: string;
  date?: string;
  amount?: number;
  currency?: string;
  vat_rate?: number;
  payment_reference?: string;
  date_delivery?: string;
  date_payment_due?: string;
  link_to_receipt_id_by_customer?: number;
}

// Transaction parameters
export interface ListTransactionsParams {
  id_by_customer_from?: number;
  id_by_customer_to?: number;
  date_from?: string;
  date_to?: string;
  account?: number;
  to_from?: string;
  limit?: number;
  offset?: number;
}

export interface CreateTransactionParams {
  account: number;
  to_from: string;
  amount: number;
  booking_date: string;
  value_date?: string;
  account_number?: string;
  bank_code?: string;
  bank_name?: string;
  purpose?: string;
  type?: string;
  booking_text?: string;
  payment_reference?: string;
  currency?: string;
}

// Invoice parameters
export interface CreateInvoiceParams {
  type: string;
  show_prices_type: string;
  company_name: string;
  date: string;
  item_name: string[];
  item_amount: string[];
  item_unit: string[];
  item_vat: string[];
  item_single_price: string[];
  contact_person_name?: string;
  street?: string;
  additional_addressline?: string;
  zip?: string;
  city?: string;
  country?: string;
  email?: string;
  recurring_interval?: string;
  recurring_date_next?: string;
  date_of_supply?: string;
  invoicenumber?: string;
  correspondence?: string;
  discount_type?: string;
  discount_value?: string;
  payment_conditions?: string;
  due_days?: string;
  final_provisions?: string;
  show_bankdata?: boolean;
  show_contactdata?: boolean;
  item_description?: string[];
  customer_number?: string;
  payment_reference?: string;
}

export interface CreateEInvoiceParams extends CreateInvoiceParams {
  item_tax_type: string[];
  item_tax_amount?: string[];
  e_invoice_id: string;
}

// Posting parameters
export interface ListPostingsParams {
  date_from: string;
  date_to: string;
  date_last_action_from?: string;
  date_last_action_to?: string;
  account?: string;
  postingaccount?: string;
  posting_status?: "all" | "fixed" | "unfixed";
  cost_location?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

export interface CreateReceiptPostingParams {
  receipt_id_by_customer: number;
  postingaccounts: string[];
  postingtexts: string[];
  vats: string[];
  amounts: string[];
  creditor?: number;
  debtor?: number;
  cost_locations?: string[];
  cost_locations_two?: string[];
}

export interface CreateTransactionPostingParams {
  transaction_id_by_customer: number;
  postingaccounts: string[];
  postingtexts: string[];
  vats: string[];
  amounts: string[];
  cost_locations?: string[];
  cost_locations_two?: string[];
  oi_receipts_ids_by_customer?: (number | null)[];
}

export interface CreateFreePostingParams {
  date: string;
  postingtext: string;
  amount: string;
  postingaccount_debit: number;
  postingaccount_credit: number;
  vat: string;
  cost_location?: string;
  cost_location_two?: string;
}

// Settings parameters
export interface DebtorParams {
  name: string;
  postingaccount_number?: string;
  contact_person_name?: string;
  street?: string;
  additional_address_line?: string;
  customer_number?: string;
  zip?: string;
  city?: string;
  country?: string;
  sales_tax_id?: string;
  email?: string;
  iban?: string;
  bic?: string;
}

export interface CreditorParams {
  name: string;
  postingaccount_number?: string;
  contact_person_name?: string;
  street?: string;
  additional_address_line?: string;
  zip?: string;
  city?: string;
  country?: string;
  sales_tax_id?: string;
  email?: string;
  iban?: string;
  bic?: string;
  due_in_days?: number;
}

export interface PostingAccountParams {
  name: string;
  postingaccount_number: number;
  parent_postingaccount_number: number;
}
