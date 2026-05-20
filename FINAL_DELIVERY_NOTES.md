# معلومات التسليم النهائية (Production Reqs)

## 1. الروابط النهائية (Webhook URLs)

هذه الروابط التي ستستخدمها في لوحات التحكم بعد ربط الدومين (استبدل `your-domain.com` برابطك الفعلي).

| المنصة | الحقل (Field) | الرابط (URL) | الطريقة (Method) | الملاحظات |
| :--- | :--- | :--- | :--- | :--- |
| **Salla Partners** | **Callback URL** | `https://your-domain.com/oauth/callback` | GET | يستخدم لإنهاء عملية تفويض التاجر (OAuth Login)|
| **Salla Partners** | **Webhook URL** | `https://your-domain.com/webhook` | POST | اختر الأحداث: `basket.abandoned`, `app.installed` |
| **Meta Developers** | **Callback URL** | `https://your-domain.com/webhook/meta` | POST/GET | Webhook Version: v18+ <br> **Verify Token**: (موجود في ملف .env) |
| **لوحة التحكم** | **Dashboard** | `https://your-domain.com` | browser | للدخول كمسؤول النظام |

---

## 2. إدارة السيرفر (PM2 Cheatsheet)

بعد الدخول للسيرفر عبر SSH، استخدم هذه الأوامر للتحكم في التطبيق:

```bash
# عرض حالة التطبيق (Online/Offline) واستهلاك الذاكرة
pm2 status

# عرض السجلات الحية (لمراقبة الأخطاء والرسائل)
pm2 logs mobher-ai-whatsapp

# إعادة تشغيل التطبيق (بعد تحديث الكود أو تغيير .env)
pm2 restart mobher-ai-whatsapp

# إيقاف التطبيق مؤقتاً
pm2 stop mobher-ai-whatsapp
```

---

## 3. محتويات ملف .env (سري للغاية)

تأكد من أن الملف `.env` على السيرفر يحتوي على القيم التالية (تم إرفاق ملف `.env.example` كنموذج):

*   `SALLA_OAUTH_CLIENT_ID`
*   `SALLA_OAUTH_CLIENT_SECRET`
*   `SALLA_WEBHOOK_SECRET`
*   `OPENAI_API_KEY`
*   `META_VERIFY_TOKEN` (من اختيارك، ضعه نفسه في Meta Dashboard)
*   `DATABASE_PASSWORD` (كلمة مرور MySQL التي أنشأتها)

---

## 4. كيفية النشر الآن (Deployment)

بما أنني لا أملك صلاحية الدخول المباشر لسيرفرك، قمت بكتابة سكربت **`server_setup.sh`** يقوم بكل العمل الصعب نيابة عنك.

### الخطوات:

1.  ارفع الملفات للسيرفر.
2.  شغل السكربت:
    ```bash
    sudo chmod +x server_setup.sh
    sudo ./server_setup.sh your-domain.com your-email@example.com
    ```
3.  سيقوم السكربت بتثبيت كل شيء وتفعيل HTTPS تلقائياً.
4.  بعدها، املأ ملف `.env` وشغل `pm2 start ecosystem.config.js`.
