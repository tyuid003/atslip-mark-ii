// Slip Verification - EasySlip API integration for slip scanning

export interface VerifySlipResult {
  success: boolean;
  data?: any;
  message?: string;
}

/**
 * Verify slip using EasySlip API
 * Supports both image file and image URL
 */
export async function verifySlip(
  env: any,
  tenantId: string,
  fileBuffer?: ArrayBuffer,
  imageUrl?: string
): Promise<VerifySlipResult> {
  try {
    // Get EasySlip token
    const token = await getEasySlipToken(env, tenantId);
    if (!token) {
      return {
        success: false,
        message: "EasySlip token not configured for this tenant"
      };
    }

    const baseUrl = "https://developer.easyslip.com/api/v1";
    let response: Response;

    console.log(`[verifySlip] Starting verification for tenant: ${tenantId}`);
    console.log(`[verifySlip] Method: ${imageUrl ? "URL" : "FILE"}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(`[verifySlip] ⚠️ Timeout reached, aborting request...`);
      controller.abort();
    }, 5000);

    try {
      if (imageUrl) {
        response = await fetch(`${baseUrl}/verify`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ url: imageUrl }),
          signal: controller.signal
        });
      } else if (fileBuffer) {
        const formData = new FormData();
        formData.append(
          "file",
          new Blob([fileBuffer], { type: "image/jpeg" }),
          "slip.jpg"
        );

        response = await fetch(`${baseUrl}/verify`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`
          },
          body: formData,
          signal: controller.signal
        });
      } else {
        clearTimeout(timeoutId);
        return {
          success: false,
          message: "No image provided"
        };
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.error(`[verifySlip] ❌ Fetch failed or timeout:`, fetchError);
      return {
        success: false,
        message: `EasySlip API timeout/error: ${
          fetchError instanceof Error ? fetchError.message : "Unknown error"
        }`
      };
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[verifySlip] ❌ EasySlip API error: ${response.status}`);
      return {
        success: false,
        message: `EasySlip API error: ${response.status} - ${errorText}`
      };
    }

    const data = await response.json();
    console.log(`[verifySlip] ✅ Response parsed successfully`);

    return {
      success: true,
      data
    };
  } catch (error) {
    console.error("Slip verification error:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Get EasySlip token from database
 * Can be tenant-specific or global
 */
async function getEasySlipToken(env: any, tenantId?: string): Promise<string | null> {
  try {
    if (tenantId) {
      const tenantResult = await env.DB.prepare(`
        SELECT token FROM easyslip_configs 
        WHERE tenant_id = ? AND is_active = TRUE
        LIMIT 1
      `).bind(tenantId).first();
      
      if (tenantResult?.token) {
        return tenantResult.token;
      }
    }

    const globalResult = await env.DB.prepare(`
      SELECT token FROM easyslip_configs 
      WHERE tenant_id IS NULL AND is_active = TRUE
      LIMIT 1
    `).first();

    return globalResult?.token || null;
  } catch (error) {
    console.error("Error getting EasySlip token:", error);
    return null;
  }
}

/**
 * Match bank account from slip to system account
 */
export async function matchAccount(
  env: any,
  tenantId: string,
  receiverAccount: string,
  receiverName?: string,
  receiverRef3?: string
): Promise<{ matched: boolean; accountId?: string; matchMethod?: string }> {
  try {
    let accounts: any[] = [];

    console.log(`[matchAccount] 🔍 Starting account match...`);
    console.log(`[matchAccount] Receiver Account: ${receiverAccount}`);
    console.log(`[matchAccount] Receiver Name: ${receiverName || "N/A"}`);

    // Try to get accounts from cache first
    const cacheKey = `tenant:${tenantId}:accounts`;
    const cached = await env.SESSION_KV.get(cacheKey);

    if (cached) {
      try {
        const cacheData = JSON.parse(cached);
        accounts = cacheData.accounts || [];
        console.log(`✅ Using cached accounts (${accounts.length} accounts)`);
      } catch (e) {
        console.warn("⚠️ Invalid cache data, will fetch fresh");
      }
    }

    if (accounts.length === 0) {
      // Fetch from backend API
      const tenantResult = await env.DB.prepare(
        `SELECT api_base_url FROM tenants WHERE tenant_id = ?`
      ).bind(tenantId).first();

      if (!tenantResult) {
        console.error(`❌ Tenant not found: ${tenantId}`);
        return { matched: false };
      }

      const sessionResult = await env.DB.prepare(
        `SELECT token FROM tenant_sessions WHERE tenant_id = ? AND status = 'ACTIVE'`
      ).bind(tenantId).first();

      if (!sessionResult) {
        console.error(`❌ No active session`);
        return { matched: false };
      }

      const response = await fetch(
        `${tenantResult.api_base_url}/api/summary-report/account-list`,
        {
          headers: {
            Authorization: `Bearer ${sessionResult.token}`
          }
        }
      );

      if (!response.ok) {
        console.error(`❌ API Error: ${response.status}`);
        return { matched: false };
      }

      const data = await response.json();
      accounts = Array.isArray(data) ? data : data.list || [];
      console.log(`✅ API returned ${accounts.length} accounts`);

      // Cache accounts
      const now = new Date().toISOString();
      const cacheTtl = 300;
      await env.SESSION_KV.put(
        cacheKey,
        JSON.stringify({ accounts, cachedAt: now }),
        { expirationTtl: cacheTtl }
      );
    }

    // Try exact match by account number
    let matchedAccount = accounts.find(
      (acc: any) =>
        acc.accountNumber === receiverAccount ||
        acc.accountNumber?.replace(/-/g, "") === receiverAccount?.replace(/-/g, "")
    );

    if (matchedAccount) {
      console.log(`✓ Matched by EXACT account number!`);
      return {
        matched: true,
        accountId: matchedAccount.id || matchedAccount.accountId,
        matchMethod: "exact-account"
      };
    }

    // Try partial match with masked digits
    if (receiverAccount && receiverAccount.includes("x")) {
      const visibleDigits = receiverAccount.replace(/[x-]/gi, "");
      if (visibleDigits.length >= 4) {
        matchedAccount = accounts.find((acc: any) => {
          const cleanAccountNumber = acc.accountNumber?.replace(/-/g, "") || "";
          return cleanAccountNumber.includes(visibleDigits);
        });

        if (matchedAccount) {
          console.log(`✓ Matched by PARTIAL digits!`);
          return {
            matched: true,
            accountId: matchedAccount.id || matchedAccount.accountId,
            matchMethod: "partial-digits"
          };
        }
      }
    }

    // Try match by name
    if (receiverName) {
      const normalizedName = receiverName.toUpperCase().trim();
      matchedAccount = accounts.find((acc: any) => {
        const accountName = (acc.accountName || "").toUpperCase().trim();
        return accountName === normalizedName || accountName.includes(normalizedName);
      });

      if (matchedAccount) {
        console.log(`✓ Matched by NAME!`);
        return {
          matched: true,
          accountId: matchedAccount.id || matchedAccount.accountId,
          matchMethod: "name-match"
        };
      }
    }

    console.log(`❌ No match found`);
    return { matched: false };
  } catch (error) {
    console.error("Account matching error:", error);
    return { matched: false };
  }
}

/**
 * Search for user by name
 */
export async function searchUser(
  env: any,
  tenantId: string,
  searchName: string,
  maskedAccount?: string,
  bankName?: string
): Promise<{ user: any | null; matchMethod?: string }> {
  try {
    console.log(`[searchUser] Searching with name: ${searchName}`);

    const tenantResult = await env.DB.prepare(
      `SELECT api_base_url FROM tenants WHERE tenant_id = ?`
    ).bind(tenantId).first();

    if (!tenantResult) {
      return { user: null };
    }

    const sessionResult = await env.DB.prepare(
      `SELECT token FROM tenant_sessions WHERE tenant_id = ? AND status = 'ACTIVE'`
    ).bind(tenantId).first();

    if (!sessionResult) {
      return { user: null };
    }

    const userCategories = ["member", "non-member"];
    let users: any[] = [];

    for (const userCategory of userCategories) {
      const params = new URLSearchParams({
        page: "1",
        limit: "50",
        userCategory
      });

      if (searchName) {
        params.append("search", searchName);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      try {
        const response = await fetch(
          `${tenantResult.api_base_url}/api/users/list?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${sessionResult.token}`
            },
            signal: controller.signal
          }
        );
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          users = data.list || [];

          if (users.length > 0) {
            console.log(`✅ Found ${users.length} users with ${userCategory}`);
            break;
          }
        }
      } catch (error) {
        clearTimeout(timeoutId);
        console.log(`Search failed for ${userCategory}`);
      }
    }

    if (users.length === 0) {
      console.log(`❌ No users found`);
      return { user: null };
    }

    // If masked account provided, try to match account
    if (maskedAccount) {
      const cleanMasked = maskedAccount.replace(/-/g, "");
      for (const user of users) {
        const userAccount = (user.bankAccount || "").replace(/-/g, "");
        if (userAccount.includes(cleanMasked)) {
          console.log(`✅ Account pattern matched!`);
          return {
            user,
            matchMethod: "name-and-account-verified"
          };
        }
      }
    }

    // Return first match
    return {
      user: users[0],
      matchMethod: "name-only"
    };
  } catch (error) {
    console.error("User search error:", error);
    return { user: null };
  }
}

/**
 * Submit credit to backend system
 */
export async function submitCredit(
  env: any,
  tenantId: string,
  slipData: any,
  user: any,
  toAccountId: string
): Promise<{ success: boolean; isDuplicate?: boolean; message?: string }> {
  try {
    const tenantResult = await env.DB.prepare(
      `SELECT api_base_url FROM tenants WHERE tenant_id = ?`
    ).bind(tenantId).first();

    if (!tenantResult) {
      return { success: false, message: "Tenant not found" };
    }

    const sessionResult = await env.DB.prepare(
      `SELECT token FROM tenant_sessions WHERE tenant_id = ? AND status = 'ACTIVE'`
    ).bind(tenantId).first();

    if (!sessionResult) {
      return { success: false, message: "Session not active" };
    }

    const hasMemberCode = user.memberCode && user.memberCode.trim() !== "";
    let payload: any;
    let apiEndpoint: string;

    if (hasMemberCode) {
      payload = {
        memberCode: user.memberCode,
        creditAmount: slipData.amount?.amount || 0,
        depositChannel: "Mobile Banking (มือถือ)",
        toAccountId,
        transferAt: slipData.date || new Date().toISOString(),
        auto: true,
        fromAccountNumber: user.bankAccount || ""
      };
      apiEndpoint = `${tenantResult.api_base_url}/api/banking/transactions/deposit-record`;
    } else {
      payload = {
        userId: user.id,
        creditAmount: slipData.amount?.amount || 0,
        depositChannel: "Mobile Banking (มือถือ)",
        toAccountId,
        transferAt: slipData.date || new Date().toISOString(),
        auto: true,
        fromAccountNumber: user.bankAccount || ""
      };
      apiEndpoint = `${tenantResult.api_base_url}/api/banking/transactions/first-time-deposit-record`;
    }

    console.log(`[submitCredit] Calling: ${apiEndpoint}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    let response: Response;
    try {
      response = await fetch(apiEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionResult.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        message: "Request timeout or network error"
      };
    } finally {
      clearTimeout(timeoutId);
    }

    let result: any;
    try {
      result = await response.json();
    } catch (e) {
      return {
        success: false,
        message: `Failed: ${response.status}`
      };
    }

    // Check for duplicate
    if (result.message === "DUPLICATE_WITH_ADMIN_RECORD") {
      return {
        success: true,
        isDuplicate: true,
        message: "⚠️ Duplicate detected"
      };
    }

    if (!response.ok) {
      return {
        success: false,
        message: `Credit failed: ${result.message || response.statusText}`
      };
    }

    console.log(`[submitCredit] ✅ Success`);
    return { success: true };
  } catch (error) {
    console.error("Credit submission error:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
