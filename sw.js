const CACHE_NAME="mtp-pwa-v6-0-32-icon";
const APP_SHELL=[
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/config.js",
  "/pwa.js",
  "/manifest.webmanifest",
  "/offline.html",
  "/favicon.ico",
  "/icons/icon-32.png",
  "/icons/icon-180.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png"
];

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(APP_SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  const req=event.request;
  if(req.method!=="GET")return;

  const url=new URL(req.url);

  // 인증/API/Supabase 데이터는 절대 캐시하지 않습니다.
  if(url.origin===self.location.origin && url.pathname.startsWith("/api/")){
    event.respondWith(fetch(req));
    return;
  }

  // 외부 CDN/지도 타일은 브라우저 기본 네트워크 동작을 사용합니다.
  if(url.origin!==self.location.origin){
    event.respondWith(fetch(req));
    return;
  }

  // 문서는 항상 최신 버전을 먼저 확인하고, 오프라인일 때만 캐시를 사용합니다.
  if(req.mode==="navigate"){
    event.respondWith(
      fetch(req)
        .then(res=>{
          const copy=res.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put("/",copy));
          return res;
        })
        .catch(async()=> (await caches.match("/")) || caches.match("/offline.html"))
    );
    return;
  }

  // 로컬 정적 파일도 Network First: 웹 업데이트가 앱에 늦게 반영되는 문제를 최소화합니다.
  event.respondWith(
    fetch(req)
      .then(res=>{
        if(res && res.ok){
          const copy=res.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(req,copy));
        }
        return res;
      })
      .catch(()=>caches.match(req))
  );
});
