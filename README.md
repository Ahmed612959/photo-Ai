# MedTranslate V2

تطبيق ترجمة صفحات الكتب الطبية بالـ Gemini: PDF/صور متعددة، حسابات، حد مجاني يومي، قاموس مصطلحات، شرح بالمصري، MCQs، Flashcards، Key Points، مقارنة، شات الصفحة، سجل ومفضلة وملاحظات، وتصدير/طباعة.

## التشغيل
npm install
cp .env.example .env
# ضع GEMINI_API_KEY في .env
npm start
ثم افتح http://localhost:3000

## مفتاح Gemini
لا تضع المفتاح داخل public/ أو HTML/JS. محليًا ضعه في .env، وعلى Vercel داخل Project Settings > Environment Variables باسم GEMINI_API_KEY. استخدم مفتاحًا جديدًا بعد تدوير المفتاح الذي ظهر في المحادثة.

## الإنتاج
التخزين المحلي مناسب للتجربة. على Vercel استخدم Upstash Redis أو قاعدة بيانات حقيقية للحسابات والسجل والكاش والـ rate limit. الدفع الحقيقي عبر Fawry/Vodafone Cash يحتاج بيانات تاجر وواجهة رسمية.
