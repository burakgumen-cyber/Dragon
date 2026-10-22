# 🌾 Avcı Toynaklar

Tarayıcıda (PC + mobil) oynanan, çok oyunculu çiftlik avı oyunu. Tavuklar (1-5 puan) ve nadir, çok hızlı tavşan (10 puan) avlanır. Silah seçeneği: tüfek (isabetli, gürültülü) veya sapan (sessiz, seri). Oyun içinde 1 / 2 / Q tuşlarıyla silah değiştirilir.

## Çalıştırma (kendi bilgisayarında)

1. [Node.js](https://nodejs.org) 18 veya üstü kurulu olsun.
2. Bu klasörde terminal aç:
   ```
   npm install
   npm start
   ```
3. Tarayıcıda `http://localhost:3000` aç.
4. Aynı Wi‑Fi'daki telefonlar, terminalde yazan `http://192.168.x.x:3000` adresinden girer
   (Windows Güvenlik Duvarı izin isterse "İzin ver" de).

## İnternetten oynamak

Sunucu sürekli açık kalmalı. Seçenekler:
- **Hızlı deneme:** `npx cloudflared tunnel --url http://localhost:3000` → verdiği https adresini arkadaşlarına gönder.
- **Kalıcı:** Render / Railway / Fly.io gibi bir Node.js hostinge klasörü yükle; başlatma komutu `npm start`. `PORT` ortam değişkeni otomatik okunur. WebSocket desteği olan bir servis seçin.

## Oynanış
- Aynı **oda adını** yazan herkes aynı çiftlikte avlanır (oda başına 8 avcı). Lobide "Pencere" veya "Siper" pozisyonu seçilir.
- PC: fareyle nişan, sol tık ateş, sağ tık / R / boşluk = doldur. Mobil: dokunduğun yere ateş, "Doldur" butonu.
- Tavuklar ahırdan, kümesten ve tarla kenarlarından çıkar; yürür, yem gagalar, ürkünce kaçar, uçar, saman balyası / çalı / kuyu / araba arkasına saklanır ve kafasını çıkarır. Saklanırken vurulamaz.
- Puan: beyaz 1, siyah 2, altın 5; uçarken vurulana +1. Tur 2 dakika, sonra skor tablosu ve yeni tur.
- Diğer avcıların nişangahları kendi renkleriyle ekranda görünür.

## Teknik
- `server.js`: otoriter sunucu (20 Hz), tavuk yapay zekası, gecikme telafili isabet kontrolü, cephane/hile koruması.
- `public/index.html`: tek dosya istemci (Canvas, WebAudio sesleri, harici görsel/ses yok).
- Ayarlar `server.js` başındaki sabitlerde: tur süresi, tavuk sayısı, şarjör vb.
