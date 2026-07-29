# 📄 جدول قرار ومراجعة إعدادات Tenant 99 (محتوى بلس) المحدث للمالك

> ⚠️ **تنبيه حازم:** هذا الملف هو مسودة مراجعة مخصصة للمالك فقط (Read-Only). **لم تُجرَ أي عملية كتابة في قاعدة بيانات Staging أو Production.**

---

### 🏛️ أولاً: فحص الربط الفعلي للحقول المنظمة في Runtime (Read-Only Audit)

أظهر الفحص الدقيق لكود التشغيل الفعلي [services/AIService.js](file:///c:/Users/mass_/OneDrive/%D8%B3%D8%B7%D8%AD%20%D8%A7%D9%84%D9%85%D9%83%D8%AA%D8%A8/ai-whatsapp-salla/services/AIService.js#L123-L130):
* `AIService.js` يقرأ فقط `kbConfig.custom_text` ويمرره إلى `storeInfo.custom_text`.
* `AIService.js` **لا يقرأ ولا يمرر** `kbConfig.cr_number` أو `kbConfig.verification_number` بشكل منظم مستقل إلى `storeInfo`.

```text
STRUCTURED_BUSINESS_FIELDS_RUNTIME_MAPPING=NOT_IMPLEMENTED
RUNTIME_READS_STRUCTURED_CR_NUMBER=NO
RUNTIME_READS_STRUCTURED_VERIFICATION_NUMBER=NO
RUNTIME_READS_CUSTOM_TEXT=YES
DUPLICATE_SOURCE_RISK=HIGH
DATABASE_WRITE_READY=NO
```

---

### 📊 ثانياً: جدول قرار المالك بنداً بنداً (Owner Decision Table)

يرجى مراجعة وتعبئة حقول القرار لكل بند أدناه (دون تعديل البنود المرفوضة حازماً):

| Item ID | Category | Item Name / Description | Proposed Value | Source Type | Confidence | APPROVE | REJECT | EDIT_REQUIRED | Owner Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| **ITM-01** | Operational | اسم البوت (`bot_name`) | `مبهر` | LEGACY_PROMPT_MANAGER | CANDIDATE | [ ] | [ ] | [ ] | |
| **ITM-02** | Operational | نبرة البوت المقترحة (`bot_tone`) | `consultant` (مستشار مبيعات خبير) | LEGACY_PROMPT_MANAGER | CANDIDATE | [ ] | [ ] | [ ] | |
| **ITM-03** | Operational | التعليمات الخاصة (`custom_instructions`) | `تعليمات محتوى بلس المعزولة...` | LEGACY_PROMPT_MANAGER | PLACEHOLDER_NOT_APPROVED | [ ] | [ ] | [ ] | مسودة مؤقتة غير صالحة للإنتاج |
| **ITM-04** | Fact | اسم النشاط (`business_name`) | `محتوى بلس` | LEGACY_PROMPT_MANAGER | CANDIDATE | [ ] | [ ] | [ ] | |
| **ITM-05** | Fact | وصف النشاط (`business_description`) | `مؤسسة متخصصة في خدمات المتاجر والتسويق` | LEGACY_PROMPT_MANAGER | CANDIDATE | [ ] | [ ] | [ ] | |
| **ITM-06** | Fact | رقم السجل التجاري (`cr_number`) | `2055157130` | LEGACY_PROMPT_MANAGER | CANDIDATE | [ ] | [ ] | [ ] | يُذكر كسجل فقط |
| **ITM-07** | Fact | رقم توثيق الأعمال (`verification_number`) | `0000210461` | LEGACY_PROMPT_MANAGER | CANDIDATE | [ ] | [ ] | [ ] | يُذكر كتوثيق أعمال صريح |
| **ITM-08** | Fact | الموقع الإلكتروني (`website`) | `mohtawaplus.com` | LEGACY_PROMPT_MANAGER | CANDIDATE | [ ] | [ ] | [ ] | |
| **ITM-09** | Fact | خدمة: تصميم المتاجر | `تصميم المتاجر الإلكترونية` | LEGACY_PROMPT_MANAGER | INCOMPLETE | [ ] | [ ] | [ ] | التفاصيل والأسعار غائبة |
| **ITM-10** | Fact | خدمة: باقات محتوى بلس | `باقات محتوى بلس` | LEGACY_PROMPT_MANAGER | INCOMPLETE | [ ] | [ ] | [ ] | غير كافية كمعرفة للبوت |
| **ITM-11** | Fact | خدمة: السيو / SEO | `تحسين محركات البحث` | LEGACY_PROMPT_MANAGER | INCOMPLETE | [ ] | [ ] | [ ] | التفاصيل والأسعار غائبة |
| **ITM-12** | Fact | أسعار الخدمات والباقات | `غير محددة` | UNKNOWN | MISSING | [ ] | [ ] | [ ] | تمنع الجاهزية الكاملة |
| **ITM-13** | Fact | ساعات العمل الرسمية | `غير محددة` | UNKNOWN | MISSING | [ ] | [ ] | [ ] | تمنع الجاهزية الكاملة |
| **ITM-14** | Fact | سياسات الخدمة والاسترجاع | `غير محددة` | UNKNOWN | MISSING | [ ] | [ ] | [ ] | تمنع الجاهزية الكاملة |

---

### ⚙️ ثالثاً: هيكل التعليمات الخاصة المطلوب اعتماد عناصرها لاحقاً (`custom_instructions`)

تم فصل الإعدادات التشغيلية والتعليمات عن الحقائق التجارية. يُطلب اعتماد العناصر التالية صراحة قبل الصياغة النهائية:
1. **هوية المساعد:** مسؤول مبيعات ومستشار محترف لـ محتوى بلس.
2. **هدف المساعد:** شرح الفائدة التجارية ومساعدة التاجر دون ضغط أو إلحاح.
3. **أسلوب الحديث:** لهجة سعودية بيضاء ودودة ومحترمة (بدون مزاح أو إيموجي مفرط).
4. **طريقة تأهيل العميل:** السؤال عن نوع متجره واحتياجه قبل اقتراح الخدمة.
5. **معالجة اعتراض السعر:** إبراز القيمة وتأكيد أن الأسعار نهائية ومحددة مسبقاً.
6. **حظر اختراع الأسعار أو الخصومات:** الالتزام التام بالأسعار المعتمدة فقط.
7. **التعامل مع المعلومات الناقصة:** التصريح بعدم توفر التفاصيل والعرض اللطيف للتحويل لموظف خدمة العملاء.

---

### 🛡️ رابعاً: قواعد سلوك المساعد عند غياب المعلومات

تم تدوين القواعد الإلزامية التالية في المقترح (وليس في قاعدة البيانات):
* **`MISSING_PRICE_BEHAVIOR`:** عدم التخمين أو إعطاء أرقام تقريبية، والاعتذار بلطف والعرض على الموظف.
* **`MISSING_PACKAGE_BEHAVIOR`:** عدم اختراع مكونات أو تفاصيل باقات غير مدعومة بمصدر رسمي.
* **`MISSING_DURATION_BEHAVIOR`:** عدم إعطاء مواعيد تنفيذ جزافية دون اعتماد رسمي.
* **`MISSING_POLICY_BEHAVIOR`:** التصريح بأن السياسة تحتاج تأكيداً من الموظف المسؤول.
* **`MISSING_BUSINESS_HOURS_BEHAVIOR`:** التصريح بأن ساعات العمل غير محددة حالياً بالنظام.
* **`HANDOFF_WHEN_INFORMATION_MISSING`:** عرض التحويل المباشر لموظف خدمة العملاء عند السؤال عن معلومات غائبة.

---

### 🔒 خامساً: ملخص حالة الجاهزية والسلامة

```text
TENANT_99_PROPOSAL_STATUS=OWNER_REVIEW_REQUIRED

CONFIRMED_BY_CURRENT_OFFICIAL_SOURCE_COUNT=0
CANDIDATE_REQUIRES_OWNER_APPROVAL_COUNT=8
PLACEHOLDER_COUNT=1
INCOMPLETE_SERVICE_COUNT=3
MISSING_REQUIRED_INFORMATION_COUNT=3
DUPLICATED_SOURCE_COUNT=0

RUNTIME_STRUCTURED_FIELDS_SUPPORT_STATUS=NOT_IMPLEMENTED
CUSTOM_TEXT_DUPLICATION_REMOVED=YES
DATABASE_WRITE_READY=NO

TENANT_99_DATABASE_UPDATED=NO
STAGING_DATABASE_UPDATED=NO
PRODUCTION_CHANGED=NO
OPENAI_CALLED=NO
HISTORICAL_CONVERSATIONS_ANALYZED=NO
REAL_MESSAGES_SENT=NO
QR_GENERATED=NO
WHATSAPP_RECONNECTED=NO
```
