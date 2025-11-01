
Uyuzsun — v2 (Admin + Rate Limit + Arşiv + Onay Kutusu)

Yeni Özellikler
- /admin panel (token ile): listele, gizle/göster, sil, 30+ gün arşivle
  - ENV değişkeni: ADMIN_TOKEN
  - UI: /admin (Authorization: Bearer <token>)
- Sunucu tarafı kelime filtreleri (api.mjs içinden genişletilebilir)
- Rate limit: IP/UA tabanlı anonim kimlik ile dakikada 20 istek
- Planlı arşiv: 30 günden eski postlar ARCHIVE_BLOB'a taşınır (listeden düşer)
- Haftalık öne çıkanlar: ⭐ sayısına göre son 7 gün / limit=5
- Disclaimer & onay kutusu: ilk paylaşımda consent zorunlu

Kurulum
1) ADMIN_TOKEN environment variable ekle (Site settings → Environment variables).
2) Paketi yükle (Upload deploy).
3) /admin sayfasına girip token ile yetkilendir.

Notlar
- anonId günlük döner; takip azaltmak için. Rate-limit ve consent için yeterlidir.
- Daha güçlü kimlik için Turnstile/ReCAPTCHA veya signed nonce eklenebilir.
