// Receipt responses
export interface ReceiptListItem {
  filename: string;
  id_by_customer: string;
  type: string;
  date: string;
  date_delivery: string;
  date_uploaded: string;
  counterparty: string;
  invoicenumber: string;
  amount: string;
  payment_date: string;
  due_date: string;
  account: string;
  link_to_receipt_id_by_customer: string;
  deleted: string;
}

export interface ReceiptDetail extends ReceiptListItem {
  amount_original: string;
  currency: string;
  currency_original: string;
  exchangerate: string;
  vat: string;
  e_invoice_type: string;
  list_direction: string;
  payment_reference: string;
  file_content?: string;
  file_type?: string;
  date_payment_due: string;
}

// Transaction responses
export interface TransactionListItem {
  id_by_customer: string;
  to_from: string;
  amount: string;
  booking_date: string;
  value_date: string;
  purpose: string;
}

export interface TransactionDetail extends TransactionListItem {
  account: number;
  currency: string;
  account_number: string;
  bank_code: string;
  bank_name: string;
  type: string;
  booking_text: string;
}

// Posting responses
export interface PostingItem {
  id_by_customer: string;
  date: string;
  date_delivery: string;
  date_vat_effective: string;
  postingtext: string;
  amount: string;
  currency: string;
  vat: string;
  credit_type: string;
  debit_postingaccount_number: string;
  credit_postingaccount_number: string;
  tax_key: string;
  booking_number: string;
  cost_location: string;
  cost_location_two: string;
  circumstances_ll: string;
  transaction_amount: string;
  transaction_purpose: string;
  receipts_assigned_ids_by_customer: string;
  receipts_assigned_types: string;
  receipts_assigned_invoice_numbers: string;
  receipts_assigned_counterparties: string;
  receipts_assigned_vat_rates: string;
  receipts_assigned_amounts: string;
  receipts_assigned_dates: string;
  receipts_assigned_links: string;
  fixed: string;
  comment: string;
  receipt_id_by_customer: string;
  transaction_id_by_customer: string;
}

// Settings responses
export interface DebtorCreditorItem {
  type: string;
  name: string;
  contact_person_name: string;
  street: string;
  additional_addressline: string;
  zip: string;
  city: string;
  country: string;
  sales_tax_id_eu: string;
  email: string;
  uid_ch: string;
  iban: string;
  bic: string;
  postingaccount_number: string;
  import_pending: number;
}

export interface PostingAccountItem {
  postingaccount_number: string;
  name: string;
  type: string;
  subtype: string;
  parent_postingaccount_number: string;
  parent_name: string;
}

// Account responses
export interface AccountItem {
  name: string;
  postingaccount_number: string;
}

// Cost location responses
export interface CostLocationItem {
  code: string;
  name: string;
}

// Assigned document responses
export interface AssignedReceiptItem {
  id_by_customer: string;
  filename: string;
}

export interface AssignedTransactionItem {
  id_by_customer: string;
  to_from: string;
  amount: string;
  booking_date: string;
  value_date: string;
  purpose: string;
}
