# Gate 11 — AI Assistant Architecture & Runtime Audit

> **Audit Mode**: Read-Only Discovery

---

## 🤖 AI Assistant Engine Parameters

```properties
AI_SETTINGS_UI_FIELDS=bot_name, bot_tone, custom_instructions, custom_text (knowledge_base), allow_discount, discount_percent
AI_BACKEND_FIELDS=crawled_policies, shipping_time, return_policy, salla_products_context, cr_number, verification_number
AI_RUNTIME_PROMPT_SOURCE=services/PromptManager.js (buildSalesAgentPrompt)
SIMULATOR_PROMPT_SOURCE=services/PromptManager.js (Identical to production runtime)
RUNTIME_SIMULATOR_PARITY=YES (100% System Prompt Parity)
ASSISTANT_NAME_USED_IN_REPLIES=YES (Configured per tenant in ai_config.bot_name)
BOT_INTRODUCES_PLATFORM_NAME=NO (Only introduces configured store_name)
TONE_VALUES=friendly, formal, professional, consultant, urgent, funny
MEMORY_MESSAGE_COUNT=15 (Last 15 conversational turns passed to OpenAI API)
HANDOFF_IMPLEMENTATION=YES (services/HandoffService.js pauses AI on human intervention)
WELCOME_IMPLEMENTATION=YES (First-time welcome message trigger)
KNOWLEDGE_IMPORT_AVAILABLE=YES (Custom text knowledge base)
WEBSITE_IMPORT_AVAILABLE=YES (Optional StorefrontCrawler background worker)
EXCEL_IMPORT_AVAILABLE=NO
DOCUMENT_IMPORT_AVAILABLE=NO
AI_VERSIONING_AVAILABLE=NO
AI_ROLLBACK_AVAILABLE=NO
CROSS_TENANT_AI_RISKS=0 (Every prompt generated dynamically using tenantId lookup)
```

---

## 🔍 System Prompt Generation Flow

1. **Message Event**: `waWeb.js` receives WhatsApp message for `tenantId`.
2. **Safety & Limit Checks**: `planGate.checkTenantAccess` and `limitsEngine.checkLimit` verify monthly AI reply allowance (`ai_replies_monthly`).
3. **Prompt Construction**: `AIService` invokes `PromptManager.buildSalesAgentPrompt`:
   - Inject Store Name (`tenant.store_name`).
   - Inject Assistant Name (`ai_config.bot_name`).
   - Inject Tone (`ai_config.bot_tone`).
   - Inject Structured Knowledge (`knowledge_base.custom_text`).
   - Inject Custom Selling Instructions (`ai_config.custom_instructions`).
   - Inject Complaint/Handoff Overrides.
4. **OpenAI Call**: `openai.chat.completions.create` with model `gpt-4o-mini`, `max_tokens: 450`, `temperature: 0.5`.
5. **Logging & Dispatch**: Logs outbound reply in `MessageLogs`, sends message via WhatsApp client, increments `UsageCounter`.
