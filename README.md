# 🌾 Avcı Toynaklar

Tarayıcıda (PC + mobil) oynanan, çok oyunculu çiftlik avı oyunu. Gümen Toynaklar Çiftliği'nde tavuklar (1-5 puan) ve nadir, çok hızlı bir tavşan (10 puan) avlanır. Aile ve arkadaşlarla aynı odada oynanır; amaç çocuklara yazılım ve yapay zekanın (Claude) neler yapabildiğini göstermektir.

**Canlı adres:** https://avci-toynaklar.onrender.com
**Kod:** https://github.com/burakgumen-cyber/Dragon

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

## Oynanış

- **Oda:** Oda adı verilmezse herkes otomatik **Toynaklar** odasına girer. Lobi, odadaki avcı sayısını gösterir (isim göstermez). Farklı bir oda adı yazan başka bir çiftlikte oynar. Oda başına 8 avcı.
- **Av süresi:** Lobide 1, 2, 3 veya 5 dakika seçilir. Süreyi odayı ilk açan kişi belirler (oda zaten açıksa odanın süresi geçerlidir). Turlar arasındaki molada herkes sonraki tur süresini değiştirebilir; oyun sırasında değişmez.
- **Rekorlar:** Her süre için ayrı en iyi 10 skor saklanır, en yüksek puan en üstte listelenir. Lobide ve tur sonu ekranında görünür. Rekor listesindeki isimler görünür, çocuklara takma ad kullanmaları önerilir.
- **Silahlar:** Lobide veya oyunda 1 / 2 / Q tuşlarıyla (mobilde silah düğmesiyle) değiştirilir.
  - 🔫 Tüfek: dürbünlü, 6 mermi, isabetli ama gürültülü, hayvanları geniş alanda ürkütür.
  - 🎯 Sapan: 10 taş, sessiz ve seri, ama isabet alanı %15 küçüktür.
  - Silahlar avcının gözünden perspektifli çizilir; nişan noktasına göre döner ve uzaklaştıkça küçülür.
- **Kontroller:** PC: fareyle nişan, sol tık ateş, sağ tık / R / boşluk = doldur. Mobil: dokunduğun yere ateş, "Doldur" düğmesi.
- **Hayvanlar:** Tavuklar ahırdan, kümesten ve tarla kenarlarından çıkar; yürür, yem gagalar, ürkünce kaçar, uçar, saman balyası / çalı / kuyu / araba arkasına saklanır ve kafasını çıkarır. Saklanırken vurulamaz. Tavuklar arada "bok bok" ve "glu glu" sesleri çıkarır.
- **Puan:** beyaz tavuk 1, siyah 2, altın 5, 🐇 tavşan 10 (ekranda aynı anda en fazla bir tane, uçmaz, çok hızlıdır), 🦆 ördek 3, 🦊 tilki 20. Uçarken vurulana +1.
- **🦊 Tilki:** Tur başladıktan 10-18 sn sonra, sonra da 25-40 sn arayla (aynı anda en fazla bir tane) kenardan sızar ve tavukları, tavşanı kapmaya çalışır. Kurnazlığı:
  - Siperden siper atlayarak sinsice yaklaşır, saklanan tavuğun yanındaki siperde pusuya yatar.
  - Yalnız kalmış ve değerli (altın, tavşan) avı seçer.
  - Nişangah yakınındaysa donup yere yapışır (hedefi %40 küçülür); ikinci kez izlenirse siper arar.
  - Yalnızca kimse izlemezken ya da avcılar mermi doldururken atılır; ateş edilince bir süre temkinli bekler.
  - Av kapınca zikzak çizerek kenara kaçar. Taşıyan tilkiyi vurursan **+5 bonus** alırsın ve av kurtulur. 3 denemede kapamazsa çekilir.
  - Tilki yaklaşınca tavuklar da ürker: uçar, saklanır ya da kaçar.
- **🦆 Ördekler:** Arka plandaki dönme dolabın 6 kabininde döner. Küçüktür, dolap hız değiştirerek döner, ördekler arada kabine eğilir, ateş sesi (tüfek geniş, sapan dar alanda) ördekleri kabine saklar. Vurulan ördek düşer, kabin bir süre boş kalıp yenisi biner. Sapan bu yüzden ördekte daha avantajlıdır.
- Diğer avcıların nişangahları kendi renkleriyle ekranda görünür.

## Tam ekran (mobil)

- **Android:** "AVA BAŞLA"ya dokununca oyun otomatik tam ekrana geçer ve ekranı yatay kilitler. Sağdaki ⛶ düğmesiyle çıkılıp girilir.
- **iPhone:** Tarayıcılar sayfaya tam ekran izni vermez. Tarayıcıda Paylaş ▸ "Ana Ekrana Ekle" yapılıp oyun ana ekran simgesinden açılırsa adres çubuğu olmadan tam sayfa açılır (`manifest.webmanifest`).

## İnternetten yayınlama (Render)

Canlı sürüm Render'da ücretsiz Node.js web servisi olarak çalışır (`render.yaml`, servis adı `avci-toynaklar`).

- Kod `Dragon` deposunun `main` dalındadır. Render, depoya push edilince **kendiliğinden yeniden kurmuyor**. Güncelleme için Render panelinde servis sayfasında **Manual Deploy ▸ Deploy latest commit** yapılır.
- Servis adresi (`onrender.com`) servis kurulurken sabitlenir; adı sonradan değiştirmek adresi değiştirmez.
- Ücretsiz planda sunucu 15 dakika boşta kalınca uyur; ilk giriş yarım dakikaya kadar sürebilir.
- Başka bir hostta çalıştırmak için başlatma komutu `npm start`, `PORT` ortam değişkeni otomatik okunur. WebSocket desteği olan bir servis seçin.
- Hızlı deneme: `npx cloudflared tunnel --url http://localhost:3000`.

### Rekorların saklanması

Rekorlar sunucuda `data/scores.json` dosyasına yazılır (`SCORES_FILE` ortam değişkeniyle değiştirilebilir; `data/` git'e eklenmez). Ücretsiz barındırmada dosya sunucu uyuyup uyanınca ya da yeniden kurulumda silinebilir. Bu yüzden her tarayıcı kendi kişisel rekorunu saklar ve oyuna girerken sunucuya geri gönderir; liste kendini toparlar, ancak yalnızca tekrar oynayan oyuncuların rekorları geri gelir. Kesin kalıcılık için kalıcı disk ya da veritabanı gerekir.

## Teknik

- `server.js`: otoriter sunucu (20 Hz), hayvan yapay zekası, gecikme telafili isabet kontrolü, cephane/hile koruması, rekor listesi. `GET /api/rooms` oda doluluğunu, `GET /api/scores` rekorları döndürür.
- `public/index.html`: tek dosya istemci (Canvas, WebAudio sesleri, harici görsel/ses yok). Arka plan bir kez çizilip saklanır, silahlar küçük bir 3B modelden perspektifle çizilir.
- Tilki yapay zekası `server.js` içinde `updFox` / `foxPlan` ile, ördekler `updDucks` ile yürür. Dönme dolabın açısı yalnızca sunucu tick'inden hesaplanır (`wheelAng`), ağdan gönderilmez; ördeklerin durumu her anlık görüntüde `d` dizisiyle gider.
- Ayarlar `server.js` başındaki sabitlerde: tur süreleri (`ROUNDS`), mola, hayvan sayısı, silahlar (`WEAPONS`), varsayılan oda (`DEFAULT_ROOM`).
- İstemci ve sunucu aynı sabitleri kullanır (dünya boyutu, siperler, ölçek, silahlar); biri değişince diğeri de değiştirilmelidir.
