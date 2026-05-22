declare module "@cashfreepayments/cashfree-js" {
  export interface CashfreeCheckoutResult {
    error?: { message?: string; type?: string };
    redirect?: boolean;
    paymentDetails?: Record<string, unknown>;
  }

  export interface CashfreeInstance {
    checkout(options: {
      paymentSessionId: string;
      redirectTarget?: "_self" | "_blank" | "_modal";
      appearance?: Record<string, unknown>;
    }): Promise<CashfreeCheckoutResult>;
  }

  export interface LoadOptions {
    mode: "sandbox" | "production";
  }

  export function load(options: LoadOptions): Promise<CashfreeInstance>;
}
