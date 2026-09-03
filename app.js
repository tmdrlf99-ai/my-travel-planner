const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const cfg=window.TRAVEL_CONFIG||{};
// v5.9: 브라우저가 Supabase에 직접 접속하지 않습니다.
// 모든 동기화는 동일 출처의 Vercel /api/travel-data 를 통해 처리합니다.
// 따라서 회사망/모바일망에서 *.supabase.co 직접 접속이 막혀도 앱 기능은 유지됩니다.
const esc=(s="")=>String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const money=n=>"₩"+Number(n||0).toLocaleString("ko-KR");

const LOCAL_KEYS={
 trips:"travel_local_trips",
 events:"travel_local_events",
 budgets:"travel_local_budgets",
 places:"travel_local_places"
};
function localRead(kind){
 try{return JSON.parse(localStorage.getItem(LOCAL_KEYS[kind])||"[]")}catch(_){return []}
}
function localWrite(kind,rows){localStorage.setItem(LOCAL_KEYS[kind],JSON.stringify(rows||[]))}
function localNextId(kind){
 const nums=localRead(kind).map(x=>Number(x.id)).filter(Number.isFinite);
 const min=nums.length?Math.min(...nums):0;
 return min<=0?min-1:-1;
}
function localUpsert(kind,row){
 const rows=localRead(kind);
 const i=rows.findIndex(x=>Number(x.id)===Number(row.id));
 if(i>=0) rows[i]={...rows[i],...row}; else rows.unshift(row);
 localWrite(kind,rows); return row;
}
function localDelete(kind,id){localWrite(kind,localRead(kind).filter(x=>Number(x.id)!==Number(id)))}
function mergeRows(serverRows,localRows){
 const map=new Map();
 (serverRows||[]).forEach(x=>map.set(String(x.id),x));
 (localRows||[]).forEach(x=>map.set(String(x.id),x));
 return [...map.values()];
}
function apiErrorText(value){
 if(value==null) return "";
 if(typeof value==="string") return value;
 if(value instanceof Error) return value.message||String(value);
 if(typeof value==="object"){
  return value.message||value.details||value.hint||value.error_description||value.error||(()=>{try{return JSON.stringify(value)}catch(_){return String(value)}})();
 }
 return String(value);
}
async function apiData(table,method="GET",row=null,id=null){
 const qs=new URLSearchParams();
 if(table) qs.set("table",table);
 if(id!==null&&id!==undefined&&id!=="") qs.set("id",String(id));
 const opt={method,headers:{"Accept":"application/json"},cache:"no-store"};
 if(row!==null){opt.headers["Content-Type"]="application/json";opt.body=JSON.stringify(row)}
 let res;
 try{res=await fetch(`/api/travel-data?${qs.toString()}`,opt)}
 catch(err){throw new Error("동기화 서버에 연결할 수 없습니다. Vercel 배포 상태를 확인해 주세요.")}
 let payload={};
 try{payload=await res.json()}catch(_){
  const txt=await res.text().catch(()=>"");
  payload=txt?{error:txt}:{};
 }
 if(!res.ok||payload.error){
  let msg=apiErrorText(payload.error)||apiErrorText(payload);
  if(res.status===404) msg="동기화 API 경로(/api/travel-data)를 찾지 못했습니다. GitHub에 api/travel-data.js가 실제 폴더 경로로 등록되어 있는지 확인해 주세요.";
  throw new Error(msg||`동기화 서버 오류 (HTTP ${res.status})`);
 }
 return payload.data;
}
function positiveServerRows(rows){return (rows||[]).filter(x=>Number(x.id)>0)}
function legacyLocalRows(kind){return localRead(kind).filter(x=>Number(x.id)<=0)}
function applyServerSnapshot(data){
 trips=mergeRows((data.trips||[]).filter(x=>x.is_visible!==false),legacyLocalRows("trips"));
 events=mergeRows((data.events||[]).filter(x=>x.is_visible!==false),legacyLocalRows("events"));
 budgets=mergeRows(data.budgets||[],legacyLocalRows("budgets"));
 places=mergeRows(data.places||[],legacyLocalRows("places"));
 // 서버 원본을 로컬 캐시에 저장하되, 아직 이관되지 않은 음수 ID 자료는 보존합니다.
 localWrite("trips",trips);localWrite("events",events);localWrite("budgets",budgets);localWrite("places",places);
}
let __serverFingerprint="";
function snapshotFingerprint(data){
 const slim=k=>(data[k]||[]).map(x=>[x.id,x.updated_at||x.created_at||""]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
 return JSON.stringify({trips:slim("trips"),events:slim("events"),budgets:slim("budgets"),places:slim("places")});
}
async function quietSync(){
 if(document.hidden||$$(`.editor-modal:not([hidden])`).length) return;
 try{
  let data=await apiData("all");
  let fp=snapshotFingerprint(data);
  if(fp===__serverFingerprint) return;
  __serverFingerprint=fp;
  applyServerSnapshot(data);
  const migrated=await autoArchiveCompletedTrips();
  if(migrated){
    data=await apiData("all");
    __serverFingerprint=snapshotFingerprint(data);
    applyServerSnapshot(data);
  }
  renderAll();
 }catch(err){console.warn("Quiet sync skipped:",err)}
}
function startAutoSync(){
 clearInterval(window.__travelSyncTimer);
 window.__travelSyncTimer=setInterval(quietSync,3000);
 document.addEventListener("visibilitychange",()=>{if(!document.hidden)quietSync()});
 window.addEventListener("focus",quietSync);
}

let trips=[],events=[],budgets=[],regions=[],worldPlaces=[],places=[];
let cal=new Date(),selectedDate="",selectedBudgetTrip="";


const PLACE_PRESETS={
 "국내":{
  "서울":[37.5665,126.9780],"부산":[35.1796,129.0756],"대구":[35.8714,128.6014],"인천":[37.4563,126.7052],
  "광주":[35.1595,126.8526],"대전":[36.3504,127.3845],"울산":[35.5384,129.3114],"세종":[36.4800,127.2890],
  "경기":[37.4138,127.5183],"강원":[37.8228,128.1555],"충북":[36.6357,127.4917],"충남":[36.5184,126.8000],
  "전북":[35.7175,127.1530],"전남":[34.8679,126.9910],"경북":[36.4919,128.8889],"경남":[35.4606,128.2132],
  "제주":[33.4996,126.5312]
 },
 "해외":{
  "일본":[36.2048,138.2529],"중국":[35.8617,104.1954],"대만":[23.6978,120.9605],"홍콩":[22.3193,114.1694],
  "마카오":[22.1987,113.5439],"베트남":[14.0583,108.2772],"태국":[15.8700,100.9925],"싱가포르":[1.3521,103.8198],
  "말레이시아":[4.2105,101.9758],"인도네시아":[-0.7893,113.9213],"필리핀":[12.8797,121.7740],"괌":[13.4443,144.7937],
  "사이판":[15.1778,145.7509],"호주":[-25.2744,133.7751],"뉴질랜드":[-40.9006,174.8860],"미국":[37.0902,-95.7129],
  "캐나다":[56.1304,-106.3468],"멕시코":[23.6345,-102.5528],"영국":[55.3781,-3.4360],"프랑스":[46.2276,2.2137],
  "독일":[51.1657,10.4515],"스위스":[46.8182,8.2275],"이탈리아":[41.8719,12.5674],"스페인":[40.4637,-3.7492],
  "포르투갈":[39.3999,-8.2245],"네덜란드":[52.1326,5.2913],"벨기에":[50.5039,4.4699],"오스트리아":[47.5162,14.5501],
  "체코":[49.8175,15.4730],"헝가리":[47.1625,19.5033],"그리스":[39.0742,21.8243],"튀르키예":[38.9637,35.2433],
  "아랍에미리트":[23.4241,53.8478],"인도":[20.5937,78.9629],"몰디브":[3.2028,73.2207],"이집트":[26.8206,30.8025],
  "남아프리카공화국":[-30.5595,22.9375],"브라질":[-14.2350,-51.9253],"아르헨티나":[-38.4161,-63.6167]
 }
};


const WORLD_COUNTRY_CITIES={
 "일본":["도쿄도","오사카시","교토시","삿포로시","후쿠오카시","나고야시","요코하마시","고베시","나라시","나하시(오키나와)"],
 "중국":["베이징시","상하이시","광저우시","선전시","청두시","시안시","칭다오시","항저우시"],
 "대만":["타이베이시","신베이시","타이중시","타이난시","가오슝시","화롄시"],
 "홍콩":["홍콩섬","구룡","신계"],
 "마카오":["마카오반도","타이파","콜로안"],
 "베트남":["하노이","호찌민시","다낭","호이안","냐짱","푸꾸옥","달랏"],
 "태국":["방콕","치앙마이","푸껫","파타야","끄라비","코사무이"],
 "싱가포르":["싱가포르"],
 "말레이시아":["쿠알라룸푸르","코타키나발루","페낭","조호르바루","말라카"],
 "인도네시아":["발리","자카르타","족자카르타","수라바야","롬복"],
 "필리핀":["마닐라","세부","보라카이","보홀","팔라완"],
 "괌":["투몬","하갓냐","데데도"],
 "사이판":["가라판","수수페","산로케"],
 "호주":["시드니","멜버른","브리즈번","골드코스트","퍼스","애들레이드","케언스"],
 "뉴질랜드":["오클랜드","웰링턴","퀸스타운","크라이스트처치","로토루아"],
 "미국":["뉴욕","로스앤젤레스","샌프란시스코","라스베이거스","호놀룰루","시카고","보스턴","워싱턴 D.C.","시애틀"],
 "캐나다":["밴쿠버","토론토","몬트리올","퀘벡시티","캘거리","오타와"],
 "멕시코":["멕시코시티","칸쿤","과달라하라","로스카보스","플라야델카르멘"],
 "영국":["런던","에든버러","맨체스터","리버풀","옥스퍼드","케임브리지"],
 "프랑스":["파리","니스","리옹","마르세유","보르도","스트라스부르"],
 "독일":["베를린","뮌헨","프랑크푸르트","함부르크","쾰른","드레스덴"],
 "스위스":["취리히","루체른","인터라켄","제네바","베른","체르마트"],
 "이탈리아":["로마","밀라노","베네치아","피렌체","나폴리","볼로냐","아말피"],
 "스페인":["마드리드","바르셀로나","세비야","그라나다","발렌시아","말라가"],
 "포르투갈":["리스본","포르투","신트라","파루","마데이라"],
 "네덜란드":["암스테르담","로테르담","헤이그","위트레흐트"],
 "벨기에":["브뤼셀","브뤼헤","겐트","앤트워프"],
 "오스트리아":["빈","잘츠부르크","인스브루크","할슈타트","그라츠"],
 "체코":["프라하","체스키크룸로프","브르노","카를로비바리"],
 "헝가리":["부다페스트","센텐드레","에게르"],
 "그리스":["아테네","산토리니","미코노스","테살로니키","크레타"],
 "튀르키예":["이스탄불","카파도키아","안탈리아","이즈미르","파묵칼레"],
 "아랍에미리트":["두바이","아부다비","샤르자"],
 "인도":["델리","뭄바이","아그라","자이푸르","벵갈루루","바라나시","고아"],
 "몰디브":["말레","마푸시","훌루말레"],
 "이집트":["카이로","기자","룩소르","아스완","후르가다","샤름엘셰이크"],
 "남아프리카공화국":["케이프타운","요하네스버그","더반","프리토리아"],
 "브라질":["리우데자네이루","상파울루","브라질리아","포스두이구아수","살바도르"],
 "아르헨티나":["부에노스아이레스","엘칼라파테","우수아이아","멘도사","바릴로체"]
};

const KR_REGION_CITIES={
 "서울":["종로구","중구","용산구","성동구","광진구","동대문구","중랑구","성북구","강북구","도봉구","노원구","은평구","서대문구","마포구","양천구","강서구","구로구","금천구","영등포구","동작구","관악구","서초구","강남구","송파구","강동구"],
 "부산":["중구","서구","동구","영도구","부산진구","동래구","남구","북구","해운대구","사하구","금정구","강서구","연제구","수영구","사상구","기장군"],
 "대구":["중구","동구","서구","남구","북구","수성구","달서구","달성군","군위군"],
 "인천":["중구","동구","미추홀구","연수구","남동구","부평구","계양구","서구","강화군","옹진군"],
 "광주":["동구","서구","남구","북구","광산구"],
 "대전":["동구","중구","서구","유성구","대덕구"],
 "울산":["중구","남구","동구","북구","울주군"],
 "세종":["세종시"],
 "경기":["수원","성남","의정부","안양","부천","광명","평택","동두천","안산","고양","과천","구리","남양주","오산","시흥","군포","의왕","하남","용인","파주","이천","안성","김포","화성","광주","양주","포천","여주","연천","가평","양평"],
 "강원":["춘천","원주","강릉","동해","태백","속초","삼척","홍천","횡성","영월","평창","정선","철원","화천","양구","인제","고성","양양"],
 "충북":["청주","충주","제천","보은","옥천","영동","증평","진천","괴산","음성","단양"],
 "충남":["천안","공주","보령","아산","서산","논산","계룡","당진","금산","부여","서천","청양","홍성","예산","태안"],
 "전북":["전주","군산","익산","정읍","남원","김제","완주","진안","무주","장수","임실","순창","고창","부안"],
 "전남":["목포","여수","순천","나주","광양","담양","곡성","구례","고흥","보성","화순","장흥","강진","해남","영암","무안","함평","영광","장성","완도","진도","신안"],
 "경북":["포항","경주","김천","안동","구미","영주","영천","상주","문경","경산","의성","청송","영양","영덕","청도","고령","성주","칠곡","예천","봉화","울진","울릉"],
 "경남":["창원","진주","통영","사천","김해","밀양","거제","양산","의령","함안","창녕","고성","남해","하동","산청","함양","거창","합천"],
 "제주":["제주","서귀포"]
};

// 자주 쓰는 도시 중심좌표. 없는 시·군은 시·도 중심좌표를 사용합니다.
const KR_CITY_COORDS={
 "수원":[37.2636,127.0286],"성남":[37.4200,127.1265],"고양":[37.6584,126.8320],"용인":[37.2411,127.1776],"화성":[37.1995,126.8312],"파주":[37.7599,126.7800],"김포":[37.6153,126.7156],
 "춘천":[37.8813,127.7298],"원주":[37.3422,127.9202],"강릉":[37.7519,128.8761],"속초":[38.2070,128.5918],"삼척":[37.4499,129.1651],"양양":[38.0754,128.6191],
 "청주":[36.6424,127.4890],"충주":[36.9910,127.9259],"제천":[37.1326,128.1910],"단양":[36.9845,128.3656],
 "천안":[36.8151,127.1139],"공주":[36.4466,127.1190],"아산":[36.7898,127.0018],"서산":[36.7845,126.4503],"보령":[36.3334,126.6129],"태안":[36.7456,126.2980],
 "전주":[35.8242,127.1480],"군산":[35.9677,126.7368],"익산":[35.9483,126.9576],"남원":[35.4164,127.3904],"부안":[35.7317,126.7332],
 "목포":[34.8118,126.3922],"여수":[34.7604,127.6622],"순천":[34.9506,127.4872],"나주":[35.0161,126.7108],"광양":[34.9407,127.6959],"해남":[34.5733,126.5990],"완도":[34.3111,126.7550],
 "포항":[36.0190,129.3435],"경주":[35.8562,129.2247],"안동":[36.5684,128.7294],"구미":[36.1195,128.3446],"경산":[35.8251,128.7415],"울진":[36.9931,129.4004],"울릉":[37.4844,130.9057],"영덕":[36.4150,129.3656],
 "창원":[35.2279,128.6811],"진주":[35.1800,128.1076],"통영":[34.8544,128.4332],"김해":[35.2285,128.8894],"거제":[34.8806,128.6211],"남해":[34.8377,127.8926],
 "제주":[33.4996,126.5312],"서귀포":[33.2541,126.5601]
};
const KR_REGION_LABELS={"경기":"경기도","강원":"강원특별자치도","충북":"충청북도","충남":"충청남도","전북":"전북특별자치도","전남":"전라남도","경북":"경상북도","경남":"경상남도","제주":"제주특별자치도"};
const regionLabel=r=>KR_REGION_LABELS[r]||r;
const METRO_REGIONS=new Set(["서울","부산","대구","인천","광주","대전","울산","세종"]);
const normalizeRegionKey=value=>{
 const v=String(value||"").trim();
 if(KR_REGION_CITIES[v]) return v;
 return Object.keys(KR_REGION_CITIES).find(k=>regionLabel(k)===v)||v;
};
function populateTripRegions(current=""){
 const key=normalizeRegionKey(current);
 tripRegionEdit.innerHTML='<option value="">시·도 선택</option>'+Object.keys(KR_REGION_CITIES)
   .map(r=>`<option value="${esc(r)}">${esc(regionLabel(r))}</option>`).join("");
 if(key&&KR_REGION_CITIES[key]) tripRegionEdit.value=key;
}
function populateTripCountries(current=""){
 const countries=Object.keys(PLACE_PRESETS["해외"]||{});
 tripCountryEdit.innerHTML='<option value="">국가 선택</option>'+countries.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
 if(current&&countries.includes(current)) tripCountryEdit.value=current;
}
function populateTripCities(region,current=""){
 const domestic=tripTypeEdit.value==="국내";
 const key=domestic?normalizeRegionKey(region):String(region||"").trim();
 const cities=domestic?(KR_REGION_CITIES[key]||[]):(WORLD_COUNTRY_CITIES[key]||[]);
 const optional=domestic&&METRO_REGIONS.has(key);
 tripCityEdit.innerHTML=`<option value="">${optional?"선택 안 함":domestic?"도시 선택":"도시·지역 선택"}</option>`+
   cities.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
 if(current&&cities.includes(current)) tripCityEdit.value=current;
 tripCityEdit.required=!optional;
 if(typeof tripCityLabel!=="undefined"&&tripCityLabel) tripCityLabel.textContent=domestic?"도시":"해외 도시·지역";
}
function syncTripLocationFields(region="",city="",country=""){
 const domestic=tripTypeEdit.value==="국내";
 tripRegionWrap.hidden=!domestic;
 tripCityWrap.hidden=false;
 tripRegionEdit.required=domestic;
 if(domestic){
   populateTripRegions(region);
   tripCountryEdit.innerHTML='<option value="대한민국">대한민국</option>';
   tripCountryEdit.value="대한민국";
   tripCountryEdit.disabled=true;
   populateTripCities(tripRegionEdit.value,city);
 }else{
   tripRegionEdit.required=false;
   tripRegionEdit.innerHTML="";
   tripCountryEdit.disabled=false;
   populateTripCountries(country);
   populateTripCities(tripCountryEdit.value,city);
 }
 tripCountryEdit.required=true;
}
const placeCities=x=>{
 const arr=Array.isArray(x?.city_names)?x.city_names:[];
 const cleaned=arr.map(v=>String(v||"").trim()).filter(Boolean);
 if(cleaned.length)return [...new Set(cleaned)];
 const legacy=String(x?.city_name||"").trim();
 return legacy?[legacy]:[];
};
const domesticPlaceText=x=>{
 const r=x.region_name||"", cities=placeCities(x);
 if(r&&cities.length) return `${regionLabel(r)} · ${cities.join(" · ")}`;
 return x.place_name||r||cities.join(" · ")||"";
};
const overseasPlaceText=x=>{
 const country=String(x.place_name||x.region_name||"").trim(),cities=placeCities(x);
 if(country&&cities.length)return `${country} · ${cities.join(" · ")}`;
 return country||cities.join(" · ")||"";
};

const KR_LUNAR_HOLIDAY_DATES={
 2026:["2026-02-17","2026-05-24","2026-09-25"],
 2027:["2027-02-07","2027-05-13","2027-09-15"],
 2028:["2028-01-27","2028-05-02","2028-10-03"],
 2029:["2029-02-13","2029-05-20","2029-09-22"],
 2030:["2030-02-03","2030-05-09","2030-09-12"],
 2031:["2031-01-23","2031-05-28","2031-10-01"],
 2032:["2032-02-11","2032-05-16","2032-09-19"],
 2033:["2033-01-31","2033-05-06","2033-09-08"],
 2034:["2034-02-19","2034-05-25","2034-09-27"],
 2035:["2035-02-08","2035-05-15","2035-09-16"],
 2036:["2036-01-28","2036-05-03","2036-10-04"],
 2037:["2037-02-15","2037-05-22","2037-09-24"],
 2038:["2038-02-04","2038-05-11","2038-09-13"],
 2039:["2039-01-24","2039-04-30","2039-10-02"],
 2040:["2040-02-12","2040-05-18","2040-09-21"],
 2041:["2041-02-01","2041-05-07","2041-09-10"],
 2042:["2042-01-22","2042-05-26","2042-09-28"],
 2043:["2043-02-10","2043-05-16","2043-09-17"],
 2044:["2044-01-30","2044-05-05","2044-10-05"],
 2045:["2045-02-17","2045-05-24","2045-09-25"],
 2046:["2046-02-06","2046-05-13","2046-09-15"],
 2047:["2047-01-26","2047-05-02","2047-10-04"],
 2048:["2048-02-14","2048-05-20","2048-09-22"],
 2049:["2049-02-02","2049-05-09","2049-09-11"],
 2050:["2050-01-23","2050-05-28","2050-09-30"]
};

// 선거일·임시공휴일처럼 사전에 계산할 수 없는 날짜는 여기에 추가합니다.
const KR_SPECIAL_HOLIDAYS={
 "2026-06-03":"지방선거일",
 "2028-04-12":"국회의원선거일"
};
const KR_HOLIDAY_CACHE={};
function isoAddDays(iso,days){
 const [y,m,d]=iso.split("-").map(Number),dt=new Date(y,m-1,d);
 dt.setDate(dt.getDate()+days);
 return fmt(dt);
}
function isoDow(iso){
 const [y,m,d]=iso.split("-").map(Number);
 return new Date(y,m-1,d).getDay();
}
function addHoliday(map,iso,name){
 if(!iso)return;
 if(map[iso]){
  const names=map[iso].split(" · ");
  if(!names.includes(name))map[iso]+=` · ${name}`;
 }else map[iso]=name;
}
function nextFreeHolidayDate(map,iso){
 let k=isoAddDays(iso,1);
 while(map[k]||isoDow(k)===0)k=isoAddDays(k,1);
 return k;
}
function getKoreanHolidays(year){
 if(KR_HOLIDAY_CACHE[year])return KR_HOLIDAY_CACHE[year];
 const h={};
 const fixed=[
  [`${year}-01-01`,"신정",false],
  [`${year}-03-01`,"삼일절",true],
  [`${year}-05-01`,"노동절",true],
  [`${year}-05-05`,"어린이날",true],
  [`${year}-06-06`,"현충일",false],
  [`${year}-07-17`,"제헌절",true],
  [`${year}-08-15`,"광복절",true],
  [`${year}-10-03`,"개천절",true],
  [`${year}-10-09`,"한글날",true],
  [`${year}-12-25`,"성탄절",true]
 ];
 fixed.forEach(([iso,name])=>addHoliday(h,iso,name));

 const lunar=KR_LUNAR_HOLIDAY_DATES[year];
 let seollal=[],chuseok=[];
 if(lunar){
  const [seol,buddha,chu]=lunar;
  seollal=[isoAddDays(seol,-1),seol,isoAddDays(seol,1)];
  addHoliday(h,seollal[0],"설날 연휴");addHoliday(h,seollal[1],"설날");addHoliday(h,seollal[2],"설날 연휴");
  addHoliday(h,buddha,"부처님오신날");
  chuseok=[isoAddDays(chu,-1),chu,isoAddDays(chu,1)];
  addHoliday(h,chuseok[0],"추석 연휴");addHoliday(h,chuseok[1],"추석");addHoliday(h,chuseok[2],"추석 연휴");
 }
 Object.entries(KR_SPECIAL_HOLIDAYS).filter(([k])=>k.startsWith(year+"-")).forEach(([k,v])=>addHoliday(h,k,v));

 // 설·추석은 연휴 중 일요일 또는 다른 공휴일과 겹치면 연휴 뒤 첫 비공휴일을 대체공휴일로 표시합니다.
 // 같은 날짜에 다른 공휴일까지 겹친 경우(예: 2028 추석+개천절)는 대체공휴일을 중복 생성하지 않습니다.
 const substituteHandledDates=new Set();
 const addGroupSubstitute=(days)=>{
  if(!days.length)return;
  const triggerDays=days.filter(k=>isoDow(k)===0 || (h[k]||"").includes(" · "));
  if(triggerDays.length){
   let sub=days[days.length-1];
   do{sub=isoAddDays(sub,1)}while(h[sub]||isoDow(sub)===0);
   addHoliday(h,sub,"대체공휴일");
   triggerDays.forEach(k=>substituteHandledDates.add(k));
  }
 };
 addGroupSubstitute(seollal);addGroupSubstitute(chuseok);

 // 국경일·부처님오신날·노동절·어린이날·성탄절은 토/일/다른 공휴일과 겹치면 대체공휴일을 부여합니다.
 const eligible=fixed.filter(x=>x[2]).map(x=>x[0]);
 if(lunar)eligible.push(lunar[1]);
 const handled=new Set();
 eligible.forEach(k=>{
  if(handled.has(k)||substituteHandledDates.has(k))return; handled.add(k);
  const weekend=isoDow(k)===0||isoDow(k)===6, overlap=(h[k]||"").includes(" · ");
  if(weekend||overlap){
   const sub=nextFreeHolidayDate(h,k);
   addHoliday(h,sub,"대체공휴일");
  }
 });
 KR_HOLIDAY_CACHE[year]=h;
 return h;
}


let koreaMap=null,worldMap=null,koreaMapMarkers=[],worldMapMarkers=[];
let koreaMunicipalityBaseGeoJSON=null,worldCountryBaseGeoJSON=null;
let koreaRegionLayerReady=false,worldCountryLayerReady=false;
let koreaRegionLayerFailed=false,worldCountryLayerFailed=false;
let selectedKoreaRegion="",selectedKoreaCity="",selectedWorldGeoName="";

const KOREA_MUNICIPALITY_KML_URL="https://cdn.jsdelivr.net/gh/southkorea/southkorea-maps@master/kostat/2013/kml/skorea_municipalities_simple.kml";
const WORLD_COUNTRY_GEOJSON_URL="https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json";

// 여행지 입력명 ↔ 세계지도 GeoJSON 국가명 매핑
const WORLD_GEO_NAME_BY_KO={
 "일본":"Japan","중국":"China","대만":"Taiwan","홍콩":"Hong Kong","마카오":"Macao",
 "베트남":"Vietnam","태국":"Thailand","싱가포르":"Singapore","말레이시아":"Malaysia","인도네시아":"Indonesia",
 "필리핀":"Philippines","괌":"Guam","사이판":"Northern Mariana Islands","호주":"Australia","뉴질랜드":"New Zealand",
 "미국":"United States of America","캐나다":"Canada","멕시코":"Mexico","영국":"United Kingdom","프랑스":"France",
 "독일":"Germany","스위스":"Switzerland","이탈리아":"Italy","스페인":"Spain","포르투갈":"Portugal",
 "네덜란드":"Netherlands","벨기에":"Belgium","오스트리아":"Austria","체코":"Czech Republic","헝가리":"Hungary",
 "그리스":"Greece","튀르키예":"Turkey","아랍에미리트":"United Arab Emirates","인도":"India","몰디브":"Maldives",
 "이집트":"Egypt","남아프리카공화국":"South Africa","브라질":"Brazil","아르헨티나":"Argentina"
};
const WORLD_KO_BY_GEO_NAME=Object.fromEntries(Object.entries(WORLD_GEO_NAME_BY_KO).map(([ko,en])=>[en,ko]));
const WORLD_GEO_ALIASES={
 "United States":"United States of America","USA":"United States of America","Czechia":"Czech Republic",
 "Türkiye":"Turkey","Macao S.A.R":"Macao","Hong Kong S.A.R.":"Hong Kong"
};
const KR_GEO_REGION_KEY={
 "서울특별시":"서울","부산광역시":"부산","대구광역시":"대구","인천광역시":"인천","광주광역시":"광주",
 "대전광역시":"대전","울산광역시":"울산","세종특별자치시":"세종","경기도":"경기","강원도":"강원",
 "강원특별자치도":"강원","충청북도":"충북","충청남도":"충남","전라북도":"전북","전북특별자치도":"전북",
 "전라남도":"전남","경상북도":"경북","경상남도":"경남","제주특별자치도":"제주"
};
// 2013 KOSTAT 시군구 지도 코드의 앞 두 자리 ↔ 현재 앱 시·도 키
const KR_GEO_REGION_BY_CODE={
 "11":"서울","21":"부산","22":"대구","23":"인천","24":"광주","25":"대전","26":"울산","29":"세종",
 "31":"경기","32":"강원","33":"충북","34":"충남","35":"전북","36":"전남","37":"경북","38":"경남","39":"제주"
};
function normalizeMunicipalityName(region,fullName){
 const name=String(fullName||'').trim();
 if(region==='세종')return '세종시';
 // 군위군은 현재 대구광역시 소속이므로 최신 앱 분류를 우선합니다.
 if(name==='군위군')return '군위군';
 if(METRO_REGIONS.has(region))return name;
 return name.replace(/(시|군)$/,'');
}

function ensureMapLegend(containerId){
 const host=document.getElementById(containerId);if(!host||host.querySelector('.travel-map-legend'))return;
 const legend=document.createElement('div');legend.className='travel-map-legend';
 legend.innerHTML='<span><i class="visited"></i>방문</span><span><i class="bucket"></i>버킷리스트</span><span><i class="none"></i>미등록</span>';
 host.appendChild(legend);
}
function kmlCoordinates(text){
 return String(text||'').trim().split(/\s+/).map(v=>v.split(',').slice(0,2).map(Number)).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
}
async function fetchKoreaMunicipalityGeoJSON(){
 const res=await fetch(KOREA_MUNICIPALITY_KML_URL,{cache:'force-cache'});if(!res.ok)throw new Error(`Korea map HTTP ${res.status}`);
 const xml=new DOMParser().parseFromString(await res.text(),'application/xml');
 const placemarks=[...xml.getElementsByTagNameNS('*','Placemark')];
 const features=[];
 placemarks.forEach((pm,idx)=>{
   const nameNode=[...pm.childNodes].find(n=>n.localName==='name');
   const fullName=(nameNode?.textContent||'').trim();
   const codeNode=[...pm.getElementsByTagNameNS('*','SimpleData')].find(n=>n.getAttribute('name')==='code');
   const code=(codeNode?.textContent||'').trim();
   let regionKey=KR_GEO_REGION_BY_CODE[code.slice(0,2)]||'';
   // 2013 지도에서는 군위군이 경북이지만 현재 행정구역은 대구입니다.
   if(fullName==='군위군')regionKey='대구';
   if(!KR_REGION_CITIES[regionKey])return;
   const cityKey=normalizeMunicipalityName(regionKey,fullName);
   if(!KR_REGION_CITIES[regionKey].includes(cityKey))return;
   const polygons=[];
   [...pm.getElementsByTagNameNS('*','Polygon')].forEach(poly=>{
     const outer=poly.getElementsByTagNameNS('*','outerBoundaryIs')[0];
     const outerCoord=outer?.getElementsByTagNameNS('*','coordinates')[0];
     const ring=kmlCoordinates(outerCoord?.textContent||'');
     if(ring.length<4)return;
     const rings=[ring];
     [...poly.getElementsByTagNameNS('*','innerBoundaryIs')].forEach(inner=>{
       const c=inner.getElementsByTagNameNS('*','coordinates')[0];const r=kmlCoordinates(c?.textContent||'');if(r.length>=4)rings.push(r);
     });
     polygons.push(rings);
   });
   if(!polygons.length)return;
   features.push({type:'Feature',id:`${regionKey}-${cityKey}-${idx}`,properties:{name:fullName,region_key:regionKey,city_key:cityKey},geometry:polygons.length===1?{type:'Polygon',coordinates:polygons[0]}:{type:'MultiPolygon',coordinates:polygons}});
 });
 return {type:'FeatureCollection',features};
}
function domesticMunicipalityStatus(region,city){
 const rows=places.filter(x=>{
   if(x.place_type!=='국내')return false;
   const rowRegion=normalizeRegionKey(x.region_name||((PLACE_PRESETS['국내']||{})[x.place_name]?x.place_name:''));
   const rowCities=placeCities(x);
   const legacyCity=(!rowCities.length&&x.region_name&&x.place_name!==x.region_name)?String(x.place_name||'').trim():'';
   return rowRegion===region&&(rowCities.includes(city)||legacyCity===city);
 });
 if(rows.some(x=>x.status==='방문'))return 'visited';
 if(rows.some(x=>x.status==='버킷리스트'))return 'bucket';
 const tripRows=trips.filter(x=>x.trip_type==='국내'&&normalizeRegionKey(x.region)===region&&String(x.city||'').trim()===city);
 if(tripRows.some(x=>x.status==='완료'))return 'visited';
 if(tripRows.some(x=>x.status==='버킷리스트'))return 'bucket';
 return 'none';
}
function decorateKoreaGeoJSON(){
 if(!koreaMunicipalityBaseGeoJSON)return null;
 return {...koreaMunicipalityBaseGeoJSON,features:koreaMunicipalityBaseGeoJSON.features.map(f=>({...f,properties:{...f.properties,travel_status:domesticMunicipalityStatus(f.properties.region_key,f.properties.city_key),selected:f.properties.region_key===selectedKoreaRegion&&f.properties.city_key===selectedKoreaCity}}))};
}
function normalizeWorldGeoName(name){return WORLD_GEO_ALIASES[name]||name||''}
function worldKoreanName(geoName){const n=normalizeWorldGeoName(geoName);return WORLD_KO_BY_GEO_NAME[n]||n}
function worldGeoNameForPlace(name){return normalizeWorldGeoName(WORLD_GEO_NAME_BY_KO[name]||name||'')}
function worldCountryStatus(geoName){
 const n=normalizeWorldGeoName(geoName),ko=worldKoreanName(n);
 const rows=places.filter(x=>x.place_type==='해외'&&worldGeoNameForPlace(x.place_name)===n);
 if(rows.some(x=>x.status==='방문'))return 'visited';
 if(rows.some(x=>x.status==='버킷리스트'))return 'bucket';
 if(trips.some(x=>x.trip_type==='해외'&&worldGeoNameForPlace(x.country)===n&&x.status==='완료'))return 'visited';
 return 'none';
}
function decorateWorldGeoJSON(){
 if(!worldCountryBaseGeoJSON)return null;
 return {...worldCountryBaseGeoJSON,features:worldCountryBaseGeoJSON.features.map((f,idx)=>{const geoName=normalizeWorldGeoName(f.properties?.name||'');return {...f,id:f.id||idx,properties:{...f.properties,geo_name:geoName,travel_status:worldCountryStatus(geoName),selected:geoName===selectedWorldGeoName}}})};
}
function updateKoreaRegionSource(){
 if(!koreaMap||!koreaRegionLayerReady)return;const data=decorateKoreaGeoJSON();if(data)koreaMap.getSource('travel-korea-regions')?.setData(data);
}
function updateWorldCountrySource(){
 if(!worldMap||!worldCountryLayerReady)return;const data=decorateWorldGeoJSON();if(data)worldMap.getSource('travel-world-countries')?.setData(data);
}
function mapFillPaint(){return {
 'fill-color':['match',['get','travel_status'],'visited','#5ebf9f','bucket','#f0a774','#dfe9e6'],
 'fill-opacity':['match',['get','travel_status'],'none',0.28,0.67]
}}
function mapLinePaint(){return {
 'line-color':['case',['boolean',['get','selected'],false],'#2d6474','#ffffff'],
 'line-width':['case',['boolean',['get','selected'],false],2.8,0.9],
 'line-opacity':0.95
}}
function showKoreaRegion(region){
 selectedKoreaRegion=normalizeRegionKey(region);selectedKoreaCity='';updateKoreaRegionSource();
 const rows=places.filter(x=>x.place_type==='국내'&&normalizeRegionKey(x.region_name||x.place_name)===selectedKoreaRegion);
 const cityNames=KR_REGION_CITIES[selectedKoreaRegion]||[];
 const visited=cityNames.filter(c=>domesticMunicipalityStatus(selectedKoreaRegion,c)==='visited').length;
 const bucket=cityNames.filter(c=>domesticMunicipalityStatus(selectedKoreaRegion,c)==='bucket').length;
 koreaRegion.textContent=regionLabel(selectedKoreaRegion);
 koreaDesc.textContent=`시·군/구 ${cityNames.length}곳 · 방문 ${visited} · 버킷리스트 ${bucket}. 지도에서는 실제 방문·버킷 시·군/구만 색칠됩니다.`;
 koreaTripList.classList.add('map-region-list');
 koreaTripList.innerHTML=cityNames.map(city=>{const st=domesticMunicipalityStatus(selectedKoreaRegion,city),label=st==='visited'?'방문':st==='bucket'?'버킷':'미등록';return `<div class="map-region-item"><div><b>${esc(city)}</b><small>${st==='none'?'아직 등록된 기록이 없습니다.':'방문지·여행 기록과 연동됨'}</small></div><span class="map-list-status ${st}">${label}</span></div>`}).join('');
}
function showKoreaMunicipality(region,city){
 selectedKoreaRegion=normalizeRegionKey(region);selectedKoreaCity=city;updateKoreaRegionSource();
 const placeRows=places.filter(x=>{
   if(x.place_type!=='국내')return false;
   const rowRegion=normalizeRegionKey(x.region_name||((PLACE_PRESETS['국내']||{})[x.place_name]?x.place_name:''));
   const rowCities=placeCities(x);
   const legacyCity=(!rowCities.length&&x.region_name&&x.place_name!==x.region_name)?String(x.place_name||'').trim():'';
   return rowRegion===selectedKoreaRegion&&(rowCities.includes(selectedKoreaCity)||legacyCity===selectedKoreaCity);
 });
 const tripRows=trips.filter(x=>x.trip_type==='국내'&&normalizeRegionKey(x.region)===selectedKoreaRegion&&String(x.city||'').trim()===selectedKoreaCity).sort((a,b)=>(b.start_date||'').localeCompare(a.start_date||''));
 const st=domesticMunicipalityStatus(selectedKoreaRegion,selectedKoreaCity);
 const label=st==='visited'?'방문 지역':st==='bucket'?'버킷리스트 지역':'미등록 지역';
 koreaRegion.textContent=`${regionLabel(selectedKoreaRegion)} · ${selectedKoreaCity}`;
 koreaDesc.textContent=`${label} · 여행 ${tripRows.length}건 · 방문지 기록 ${placeRows.length}건. 이 시·군/구의 실제 영역만 지도에 표시됩니다.`;
 koreaTripList.classList.add('map-region-list');
 const cards=[];
 tripRows.forEach(x=>cards.push(`<div class="map-region-item"><div><b>${esc(x.title)}</b><small>${esc(x.start_date||'')}${x.end_date?` ~ ${esc(x.end_date)}`:''}${x.memo?` · ${esc(x.memo)}`:''}</small></div><span class="map-list-status ${x.status==='완료'?'visited':x.status==='버킷리스트'?'bucket':'none'}">${esc(x.status||'예정')}</span></div>`));
 placeRows.filter(x=>!x.source_trip_id).forEach(x=>cards.push(`<div class="map-region-item"><div><b>${esc(selectedKoreaCity)}</b><small>${esc(x.memo||'직접 등록한 방문지')}</small></div><span class="map-list-status ${x.status==='방문'?'visited':'bucket'}">${esc(x.status)}</span></div>`));
 koreaTripList.innerHTML=cards.length?cards.join(''):'<div class="empty-mini">이 지역에 등록된 여행 또는 방문지 기록이 없습니다.</div>';
}
function showWorldCountry(geoName){
 selectedWorldGeoName=normalizeWorldGeoName(geoName);updateWorldCountrySource();
 const ko=worldKoreanName(selectedWorldGeoName);
 const placeRows=places.filter(x=>x.place_type==='해외'&&worldGeoNameForPlace(x.place_name)===selectedWorldGeoName);
 const tripRows=trips.filter(x=>x.trip_type==='해외'&&worldGeoNameForPlace(x.country)===selectedWorldGeoName).sort((a,b)=>(b.start_date||'').localeCompare(a.start_date||''));
 const status=worldCountryStatus(selectedWorldGeoName);
 const recordedCities=[...new Set([...placeRows.flatMap(placeCities),...tripRows.map(x=>String(x.city||'').trim()).filter(Boolean)])];
 worldCountry.textContent=ko;
 worldDesc.textContent=`${status==='visited'?'방문 국가':status==='bucket'?'버킷리스트 국가':'미등록 국가'} · 도시/지역 ${recordedCities.length}곳 · 여행 ${tripRows.length}건 · 방문지 기록 ${placeRows.length}건`;
 worldTripList.classList.add('map-region-list');
 const cards=[];
 const cityStatus=new Map();
 placeRows.forEach(x=>placeCities(x).forEach(city=>{const prev=cityStatus.get(city);if(x.status==='방문'||!prev)cityStatus.set(city,x.status)}));
 tripRows.forEach(x=>{const city=String(x.city||'').trim();if(city&&x.status==='완료')cityStatus.set(city,'방문')});
 recordedCities.forEach(city=>{const st=cityStatus.get(city)||'예정';cards.push(`<div class="map-region-item"><div><b>${esc(city)}</b><small>${esc(ko)} · 등록된 도시/지역</small></div><span class="map-list-status ${st==='방문'?'visited':st==='버킷리스트'?'bucket':'none'}">${esc(st)}</span></div>`)});
 tripRows.forEach(x=>cards.push(`<div class="map-region-item"><div><b>${esc(x.city||x.title)}</b><small>${esc(x.title)} · ${esc(x.start_date||'')} ${x.end_date?`~ ${esc(x.end_date)}`:''}</small></div><span class="map-list-status ${x.status==='완료'?'visited':x.status==='버킷리스트'?'bucket':'none'}">${esc(x.status||'예정')}</span></div>`));
 placeRows.filter(x=>!placeCities(x).length&&!x.source_trip_id).forEach(x=>cards.push(`<div class="map-region-item"><div><b>${esc(x.place_name)}</b><small>${esc(x.memo||'직접 등록한 방문지')}</small></div><span class="map-list-status ${x.status==='방문'?'visited':'bucket'}">${esc(x.status)}</span></div>`));
 worldTripList.innerHTML=cards.length?cards.join(''):'<div class="empty-mini">이 국가에 등록된 여행 또는 방문지 기록이 없습니다.</div>';
}

async function setupKoreaRegionLayer(){
 try{
   koreaMunicipalityBaseGeoJSON=await fetchKoreaMunicipalityGeoJSON();
   if(!koreaMap||koreaMap.getSource('travel-korea-regions'))return;
   koreaMap.addSource('travel-korea-regions',{type:'geojson',data:decorateKoreaGeoJSON()});
   koreaMap.addLayer({id:'travel-korea-fill',type:'fill',source:'travel-korea-regions',paint:mapFillPaint()});
   koreaMap.addLayer({id:'travel-korea-line',type:'line',source:'travel-korea-regions',paint:mapLinePaint()});
   koreaRegionLayerReady=true;clearMapMarkers(koreaMapMarkers);updateKoreaRegionSource();
   koreaMap.on('mouseenter','travel-korea-fill',()=>{koreaMap.getCanvas().style.cursor='pointer'});
   koreaMap.on('mouseleave','travel-korea-fill',()=>{koreaMap.getCanvas().style.cursor=''});
   koreaMap.on('click','travel-korea-fill',e=>{const f=e.features?.[0];if(f?.properties?.region_key&&f?.properties?.city_key)showKoreaMunicipality(f.properties.region_key,f.properties.city_key)});
 }catch(err){console.warn('Korea municipality fill map unavailable; marker fallback retained.',err);koreaRegionLayerFailed=true;renderKoreaFallbackMarkers();}
}
async function setupWorldCountryLayer(){
 try{
   const res=await fetch(WORLD_COUNTRY_GEOJSON_URL,{cache:'force-cache'});if(!res.ok)throw new Error(`World map HTTP ${res.status}`);
   worldCountryBaseGeoJSON=await res.json();
   if(!worldMap||worldMap.getSource('travel-world-countries'))return;
   worldMap.addSource('travel-world-countries',{type:'geojson',data:decorateWorldGeoJSON()});
   worldMap.addLayer({id:'travel-world-fill',type:'fill',source:'travel-world-countries',paint:mapFillPaint()});
   worldMap.addLayer({id:'travel-world-line',type:'line',source:'travel-world-countries',paint:mapLinePaint()});
   worldCountryLayerReady=true;clearMapMarkers(worldMapMarkers);updateWorldCountrySource();
   worldMap.on('mouseenter','travel-world-fill',()=>{worldMap.getCanvas().style.cursor='pointer'});
   worldMap.on('mouseleave','travel-world-fill',()=>{worldMap.getCanvas().style.cursor=''});
   worldMap.on('click','travel-world-fill',e=>{const f=e.features?.[0];const n=f?.properties?.geo_name||f?.properties?.name;if(n)showWorldCountry(n)});
 }catch(err){console.warn('World fill map unavailable; marker fallback retained.',err);worldCountryLayerFailed=true;renderWorldFallbackMarkers();}
}



function friendlyError(err){
 const raw=(err&&err.message)||String(err||"");
 if(/failed to fetch|동기화 서버에 연결/i.test(raw)) return "동기화 서버에 연결할 수 없습니다. Vercel 배포 상태를 확인해 주세요.";
 if(/row-level security|rls/i.test(raw)) return "현재 데이터 저장 권한이 설정되지 않았습니다. Supabase 권한 설정을 확인해 주세요.";
 if(/relation .* does not exist|could not find/i.test(raw)) return "필요한 데이터 테이블이 아직 준비되지 않았습니다. Supabase SQL 설정을 먼저 확인해 주세요.";
 return raw || "저장 중 오류가 발생했습니다.";
}
function showFormError(formId,err){
 const el=document.getElementById(formId+"Error");
 if(!el){toast(friendlyError(err));return;}
 el.textContent=friendlyError(err);
 el.hidden=false;
}
function clearFormError(formId){
 const el=document.getElementById(formId+"Error");
 if(el){el.hidden=true;el.textContent="";}
}

function toast(msg){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.hidden=true,2200)}
function openModal(id){$("#editorBackdrop").hidden=false;$("#"+id).hidden=false}
function closeModal(id){$("#"+id).hidden=true;if($$(".editor-modal:not([hidden])").length===0)$("#editorBackdrop").hidden=true}
$$("[data-close]").forEach(b=>b.addEventListener("click",()=>closeModal(b.dataset.close)));
$("#editorBackdrop").addEventListener("click",()=>{$$(".editor-modal").forEach(m=>m.hidden=true);$("#editorBackdrop").hidden=true});

async function loadAll(){
 const localTrips=localRead("trips"),localEvents=localRead("events"),localBudgets=localRead("budgets"),localPlaces=localRead("places");
 try{
  let data=await apiData("all");
  __serverFingerprint=snapshotFingerprint(data);
  applyServerSnapshot(data);
  const migrated=await autoArchiveCompletedTrips();
  if(migrated){
    data=await apiData("all");
    __serverFingerprint=snapshotFingerprint(data);
    applyServerSnapshot(data);
  }
 }catch(err){
  console.warn("Server sync unavailable; using local cache.",err);
  trips=localTrips;events=localEvents;budgets=localBudgets;places=localPlaces;
 }
 renderAll();
}
function completedTripPlacePayload(x){
 const type=x.trip_type==="해외"?"해외":"국내";
 const region=type==="국내"?normalizeRegionKey(x.region):"";
 const city=String(x.city||"").trim();
 const country=(x.country|| (type==="국내"?"대한민국":"")).trim();
 const coord=type==="국내"
   ? (KR_CITY_COORDS[city]||(PLACE_PRESETS["국내"]||{})[region]||[36.5,127.8])
   : ((PLACE_PRESETS["해외"]||{})[country]||[0,0]);
 const placeName=type==="국내"?(city||regionLabel(region)||x.title):(country||x.title);
 const sourceMemo=[`지역별 일정 자동등록 · ${x.title}`,x.memo||""].filter(Boolean).join("\n");
 return {
   place_type:type,
   status:"방문",
   place_name:placeName,
   region_name:region,
   city_name:city,
   city_names:city?[city]:[],
   latitude:coord[0],
   longitude:coord[1],
   start_date:x.start_date||x.end_date||null,
   end_date:x.end_date||x.start_date||null,
   author_name:x.author_name||"",
   memo:sourceMemo,
   source_trip_id:Number(x.id),
   updated_at:new Date().toISOString()
 };
}
async function autoArchiveCompletedTrips(){
 const today=fmt(new Date());
 const targets=trips.filter(x=>Number(x.id)>0&&x.end_date&&x.end_date<today&&x.status!=="버킷리스트");
 if(!targets.length)return false;
 let changed=false;
 for(const trip of targets){
   try{
     if(trip.status!=="완료"){
       await apiData("travel_trips","PUT",{...trip,status:"완료",updated_at:new Date().toISOString()},trip.id);
       trip.status="완료";
       changed=true;
     }
     const already=places.some(p=>Number(p.source_trip_id)===Number(trip.id));
     if(!already){
       const saved=await apiData("travel_places","POST",completedTripPlacePayload(trip));
       if(saved) places.unshift(saved);
       changed=true;
     }
   }catch(err){
     console.warn(`완료 여행 자동 방문지 등록 실패: ${trip.title}`,err);
   }
 }
 return changed;
}
function renderAll(){renderHero();renderUpcoming();renderCalendar();renderKorea();renderWorld();renderPlaces();renderBoard();renderBudgetOptions();renderBudget();fillEditTripSelects()}
function renderHero(){
 const now=new Date(),future=trips.filter(x=>x.start_date&&new Date(x.start_date+"T00:00:00")>=new Date(now.toDateString())).sort((a,b)=>a.start_date.localeCompare(b.start_date));
 const next=future[0];
 sideNextTrip.textContent=next?.title||"아직 예정 여행이 없습니다";
 sideNextDates.textContent=next?`${next.start_date} ~ ${next.end_date||next.start_date}`:"새 여행을 등록해 보세요.";
 if(next){const d=Math.ceil((new Date(next.start_date+"T00:00:00")-new Date(now.toDateString()))/86400000);sideNextDday.textContent=d>=0?`D-${d}`:"여행중"}else sideNextDday.textContent="READY";
 statTrips.textContent=trips.length;
 // 방문 지역은 시·군·구 개수가 아니라 상위 시·도 기준으로 집계합니다.
 // 예: 서울 종로구·마포구·영등포구를 모두 방문해도 "서울" 1개 지역으로 계산합니다.
 const domesticVisitedRegions=new Set(
   places
     .filter(x=>x.place_type==="국내"&&x.status==="방문")
     .map(x=>{
       const region=normalizeRegionKey(x.region_name||"");
       const legacy=normalizeRegionKey(String(x.place_name||"").trim());
       return region||legacy;
     })
     .filter(region=>region&&KR_REGION_CITIES[region])
 );
 trips.filter(x=>x.trip_type==="국내"&&x.status==="완료").forEach(x=>{
   const region=normalizeRegionKey(x.region||"");
   if(region&&KR_REGION_CITIES[region])domesticVisitedRegions.add(region);
 });
 statCities.textContent=domesticVisitedRegions.size;

 const visitedCountries=new Set(
   places.filter(x=>x.place_type==="해외"&&x.status==="방문").map(x=>x.place_name).filter(Boolean)
 );
 trips.filter(x=>x.trip_type==="해외"&&x.status==="완료").forEach(x=>{if(x.country)visitedCountries.add(x.country)});
 statCountries.textContent=visitedCountries.size;
 const total=budgets.reduce((s,x)=>s+Number(x.budget_amount||0),0),spent=budgets.reduce((s,x)=>s+Number(x.spent_amount||0),0),rate=total?Math.round(spent/total*100):0;
 heroBudget.textContent=money(total);heroBudgetDetail.textContent=`지출 ${money(spent)} / ${rate}%`;budgetProgress.style.width=Math.min(rate,100)+"%";
}
function renderUpcoming(){
 const now=new Date(),future=trips.filter(x=>x.start_date&&new Date(x.start_date+"T00:00:00")>=new Date(now.toDateString())).slice(0,4);
 upcomingTrips.innerHTML=future.length?future.map(x=>{const d=Math.ceil((new Date(x.start_date+"T00:00:00")-new Date(now.toDateString()))/86400000);return `<div data-trip="${x.id}"><time>${x.start_date.slice(5).replace("-",".")}</time><p><b>${esc(x.title)}</b><small>${esc(x.city||x.country||"")} · ${esc(x.trip_type)}${x.author_name?` · ${esc(x.author_name)}`:""}</small></p><span>${d>=0?`D-${d}`:"NOW"}</span></div>`}).join(""):'<div class="empty-mini">예정된 여행이 없습니다.</div>';
 $$("#upcomingTrips [data-trip]").forEach(el=>el.addEventListener("click",()=>editTrip(Number(el.dataset.trip))));
 const cats=["교통","숙박","식비","관광·쇼핑"];budgetMini.innerHTML=cats.map(c=>{const sum=budgets.filter(x=>x.category===c).reduce((s,x)=>s+Number(x.budget_amount||0),0);return `<div><span>${c}</span><strong>${money(sum)}</strong></div>`}).join("");
}
function fmt(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function dateInRange(k,start,end){
 if(!start)return false;
 const e=end||start;
 return k>=start&&k<=e;
}
function tripOnDate(x,k){return dateInRange(k,x.start_date,x.end_date)}
function placeOnDate(x,k){return dateInRange(k,x.start_date,x.end_date)}
function renderCalendar(){
 const y=cal.getFullYear(),m=cal.getMonth();monthTitle.textContent=`${y}년 ${m+1}월`;
 const first=new Date(y,m,1),start=new Date(y,m,1-first.getDay()),today=fmt(new Date());
 let html="";
 for(let i=0;i<42;i++){
   const d=new Date(start);d.setDate(start.getDate()+i);
   const k=fmt(d),dow=d.getDay(),holiday=getKoreanHolidays(d.getFullYear())[k]||"";
   const has=events.some(x=>x.event_date===k)||trips.some(x=>tripOnDate(x,k))||places.some(x=>placeOnDate(x,k));
   const cls=[
     "day",
     d.getMonth()!==m?"other":"",
     k===today?"today":"",
     k===selectedDate?"selected":"",
     has?"has-event":"",
     dow===0?"sunday":"",
     dow===6?"saturday":"",
     holiday?"holiday":""
   ].filter(Boolean).join(" ");
   html+=`<button class="${cls}" data-date="${k}" title="${holiday||""}"><span>${d.getDate()}</span>${holiday?`<small class="holiday-name">${esc(holiday)}</small>`:""}</button>`;
 }
 calendarGrid.innerHTML=html;
 $$(".day").forEach(b=>b.onclick=()=>{selectedDate=selectedDate===b.dataset.date?"":b.dataset.date;renderCalendar()});
 renderDay();
}
function shortCalendarDate(iso){
 if(!iso)return "";
 const parts=iso.split("-");
 return `${Number(parts[1])}.${Number(parts[2])}`;
}
function calendarRangeLabel(start,end){
 if(!start)return "";
 const e=end||start;
 return start===e?shortCalendarDate(start):`${shortCalendarDate(start)}~${shortCalendarDate(e)}`;
}
function overlapsRange(start,end,from,to){
 if(!start)return false;
 const e=end||start;
 return start<=to&&e>=from;
}
function renderDay(){
 let list=[];
 if(selectedDate){
  list=[...events.filter(x=>x.event_date===selectedDate).map(x=>({id:x.id,kind:"event",badge:x.category||"일정",dateLabel:shortCalendarDate(x.event_date),title:x.title,sub:x.description||"",author:x.author_name||"",sortKey:x.event_date})),
   ...trips.filter(x=>tripOnDate(x,selectedDate)).map(x=>({id:x.id,kind:"trip",badge:x.start_date===selectedDate?"출발":x.end_date===selectedDate?"종료":"여행중",dateLabel:shortCalendarDate(selectedDate),title:x.title,sub:x.city||x.country||x.region||"",author:x.author_name||"",sortKey:x.start_date||selectedDate})),
   ...places.filter(x=>placeOnDate(x,selectedDate)).map(x=>({id:x.id,kind:"place",badge:x.status==="버킷리스트"?"방문계획":"방문지",dateLabel:shortCalendarDate(selectedDate),title:x.place_type==="국내"?domesticPlaceText(x):x.place_name,sub:x.memo||x.place_type||"",author:x.author_name||"",sortKey:x.start_date||selectedDate}))];
  dayTitle.textContent=`${Number(selectedDate.slice(5,7))}월 ${Number(selectedDate.slice(8,10))}일 일정`;
  if(typeof monthOverviewBtn!=="undefined"&&monthOverviewBtn)monthOverviewBtn.hidden=false;
 }else{
  const y=cal.getFullYear(),m=cal.getMonth();
  const from=fmt(new Date(y,m,1)),to=fmt(new Date(y,m+1,0));
  list=[...events.filter(x=>x.event_date>=from&&x.event_date<=to).map(x=>({id:x.id,kind:"event",badge:x.category||"일정",dateLabel:shortCalendarDate(x.event_date),title:x.title,sub:x.description||"",author:x.author_name||"",sortKey:x.event_date})),
   ...trips.filter(x=>overlapsRange(x.start_date,x.end_date,from,to)).map(x=>({id:x.id,kind:"trip",badge:"여행",dateLabel:calendarRangeLabel(x.start_date,x.end_date),title:x.title,sub:x.city||x.country||x.region||"",author:x.author_name||"",sortKey:x.start_date||from})),
   ...places.filter(x=>overlapsRange(x.start_date,x.end_date,from,to)).map(x=>({id:x.id,kind:"place",badge:x.status==="버킷리스트"?"방문계획":"방문지",dateLabel:calendarRangeLabel(x.start_date,x.end_date),title:x.place_type==="국내"?domesticPlaceText(x):x.place_name,sub:x.memo||x.place_type||"",author:x.author_name||"",sortKey:x.start_date||from}))];
  dayTitle.textContent=`${m+1}월 전체 일정`;
  if(typeof monthOverviewBtn!=="undefined"&&monthOverviewBtn)monthOverviewBtn.hidden=true;
 }
 list.sort((a,b)=>(a.sortKey||"").localeCompare(b.sortKey||"")||a.title.localeCompare(b.title,"ko"));
 dayCount.textContent=`${list.length}건`;
 dayEvents.innerHTML=list.length?list.map(x=>`<div class="day-event" data-kind="${x.kind}" data-id="${x.id}"><time title="${esc(x.badge)}"><b>${esc(x.dateLabel)}</b><small>${esc(x.badge)}</small></time><div><strong>${esc(x.title)}</strong><small>${esc(x.sub)}${x.author?` · 작성 ${esc(x.author)}`:""}</small></div></div>`).join(""):`<div class="empty">${selectedDate?"선택한 날짜에 등록된 일정이 없습니다.":"이 달에 등록된 여행 일정이 없습니다."}</div>`;
 $$("#dayEvents .day-event").forEach(el=>el.onclick=()=>{
  const id=Number(el.dataset.id);
  if(el.dataset.kind==="event")editEvent(id);
  else if(el.dataset.kind==="place")editPlace(id);
  else editTrip(id);
 });
}
prevMonth.onclick=()=>{selectedDate="";cal.setMonth(cal.getMonth()-1);renderCalendar()};
nextMonth.onclick=()=>{selectedDate="";cal.setMonth(cal.getMonth()+1);renderCalendar()};
todayMonth.onclick=()=>{selectedDate="";cal=new Date();renderCalendar()};
if(typeof monthOverviewBtn!=="undefined"&&monthOverviewBtn)monthOverviewBtn.onclick=()=>{selectedDate="";renderCalendar()};
function ensureKoreaMap(){
 if(koreaMap || typeof maplibregl==="undefined") return;
 koreaMap=new maplibregl.Map({
   container:"koreaRealMap",
   style:{
     version:8,
     sources:{osm:{type:"raster",tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],tileSize:256,attribution:"© OpenStreetMap contributors"}},
     layers:[{id:"osm",type:"raster",source:"osm"}]
   },
   center:[127.8,36.3],
   zoom:6.1,
   minZoom:5,
   maxZoom:12
 });
 koreaMap.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-left");
 ensureMapLegend('koreaRealMap');
 koreaMap.on('load',setupKoreaRegionLayer);
}
function clearMapMarkers(list){list.forEach(x=>x.remove());list.length=0}
function markerElement(status){
 const el=document.createElement("button");
 el.type="button";
 el.className=`place-marker ${status==="방문"?"visited":"bucket"}`;
 el.title=status;
 return el;
}
function renderKoreaFallbackMarkers(){
 if(!koreaMap)return;clearMapMarkers(koreaMapMarkers);
 places.filter(x=>x.place_type==='국내').forEach(x=>{
   const region=normalizeRegionKey(x.region_name||x.place_name),cities=placeCities(x);
   const targets=cities.length?cities:[""];
   targets.forEach(city=>{
     const coord=city?(KR_CITY_COORDS[city]||(PLACE_PRESETS["국내"]||{})[region]):[Number(x.latitude),Number(x.longitude)];
     const lat=city?coord?.[0]:Number(x.latitude),lng=city?coord?.[1]:Number(x.longitude);
     if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng)))return;
     const el=markerElement(x.status),marker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([Number(lng),Number(lat)]).addTo(koreaMap);
     el.addEventListener('click',()=>city?showKoreaMunicipality(region,city):showKoreaRegion(region));koreaMapMarkers.push(marker);
   });
 });
}
function renderKorea(){
 ensureKoreaMap();if(!koreaMap)return;
 if(koreaRegionLayerReady){clearMapMarkers(koreaMapMarkers);updateKoreaRegionSource();}
 else renderKoreaFallbackMarkers();
 setTimeout(()=>koreaMap.resize(),120);
}

function ensureWorldMap(){
 if(worldMap || typeof maplibregl==="undefined") return;
 worldMap=new maplibregl.Map({
   container:"worldRealMap",
   style:{
     version:8,
     sources:{osm:{type:"raster",tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],tileSize:256,attribution:"© OpenStreetMap contributors"}},
     layers:[{id:"osm",type:"raster",source:"osm"}]
   },
   center:[10,20],
   zoom:1.3,
   minZoom:1,
   maxZoom:8
 });
 worldMap.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-left");
 ensureMapLegend('worldRealMap');
 worldMap.on('load',setupWorldCountryLayer);
}
function renderWorldFallbackMarkers(){
 if(!worldMap)return;clearMapMarkers(worldMapMarkers);
 const availableGeoNames=new Set(worldCountryBaseGeoJSON?.features?.map(f=>normalizeWorldGeoName(f.properties?.name||''))||[]);
 places.filter(x=>x.place_type==='해외').forEach(x=>{
   // 국가 폴리곤이 없는 작은 섬/영토 또는 지도 데이터 로드 실패 시에만 점 마커를 사용
   const geo=worldGeoNameForPlace(x.place_name);if(worldCountryLayerReady&&availableGeoNames.has(geo))return;
   if(!Number.isFinite(Number(x.longitude))||!Number.isFinite(Number(x.latitude)))return;
   const el=markerElement(x.status),marker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([Number(x.longitude),Number(x.latitude)]).addTo(worldMap);
   el.addEventListener('click',()=>showWorldCountry(geo));worldMapMarkers.push(marker);
 });
}
function renderWorld(){
 ensureWorldMap();if(!worldMap)return;
 if(worldCountryLayerReady){updateWorldCountrySource();renderWorldFallbackMarkers();}
 else renderWorldFallbackMarkers();
 setTimeout(()=>worldMap.resize(),120);
}


function selectedPlaceCities(){
 return [...placeCityEdit.querySelectorAll('input[type="checkbox"]:checked')].map(el=>el.value);
}
function populatePlaceCities(parent,current=[]){
 const domestic=placeTypeEdit.value==="국내";
 const cities=domestic?(KR_REGION_CITIES[parent]||[]):(WORLD_COUNTRY_CITIES[parent]||[]);
 const selected=new Set(Array.isArray(current)?current:(current?[current]:[]));
 placeCityEdit.innerHTML=cities.map(c=>`<label class="multi-city-option"><input type="checkbox" value="${esc(c)}" ${selected.has(c)?"checked":""}/><span>${esc(c)}</span></label>`).join("");
 placeCityWrap.hidden=false;
 if(typeof placeCityLabel!=="undefined"&&placeCityLabel)placeCityLabel.textContent=domestic?"도시·군·구":"해외 도시·지역";
 const help=placeCityWrap.querySelector('.multi-city-help');if(help)help.textContent=domestic?"여러 지역을 방문했다면 복수 선택할 수 있습니다.":"한 국가에서 여러 도시를 방문했다면 복수 선택할 수 있습니다.";
}
function populatePlaceNames(type,current="",currentCities=[]){
 const names=Object.keys(PLACE_PRESETS[type]||{});
 placeNameEdit.innerHTML=names.map(n=>`<option value="${esc(n)}">${esc(type==="국내"?regionLabel(n):n)}</option>`).join("");
 if(current&&names.includes(current)) placeNameEdit.value=current;
 populatePlaceCities(placeNameEdit.value,currentCities);
}
function renderPlaces(){
 const domesticCount=status=>new Set(places.filter(x=>x.place_type==="국내"&&x.status===status).flatMap(x=>{const region=normalizeRegionKey(x.region_name||"");const cities=placeCities(x);return cities.length?cities.map(c=>`${region}::${c}`):[x.place_name||region].filter(Boolean)})).size;
 const dv=domesticCount("방문");
 const db=domesticCount("버킷리스트");
 const overseasCount=status=>new Set(places.filter(x=>x.place_type==="해외"&&x.status===status).flatMap(x=>{const cities=placeCities(x);return cities.length?cities.map(c=>`${x.place_name}::${c}`):[x.place_name].filter(Boolean)})).size;
 const ov=overseasCount("방문");
 const ob=overseasCount("버킷리스트");
 domesticVisitedCount.textContent=dv;domesticBucketCount.textContent=db;overseasVisitedCount.textContent=ov;overseasBucketCount.textContent=ob;

 const q=placeSearch.value.trim().toLowerCase(),type=placeTypeFilter.value,status=placeStatusFilter.value;
 const rows=places.filter(x=>(!type||x.place_type===type)&&(!status||x.status===status)&&(`${x.place_name} ${x.region_name||""} ${placeCities(x).join(" ")} ${x.memo||""} ${x.author_name||""}`.toLowerCase().includes(q)));
 placeList.innerHTML=rows.length?rows.map(x=>`<div class="place-row" data-place="${x.id}">
   <span>${esc(x.place_type)}</span>
   <span class="place-status ${x.status==="방문"?"visited":"bucket"}">${esc(x.status)}</span>
   <b>${esc(x.place_type==="국내"?domesticPlaceText(x):overseasPlaceText(x))}</b>
   <small class="place-memo">${esc(x.memo||"-")}</small>
   <small class="place-author">${esc(x.author_name||"-")}</small>
 </div>`).join(""):'<div class="empty-mini">등록된 방문지가 없습니다.</div>';
 $$("#placeList [data-place]").forEach(el=>el.onclick=()=>editPlace(Number(el.dataset.place)));
}
function resetPlaceForm(){
 placeFormPublic.reset();placeEditId.value="";placeModalTitle.textContent="방문지 등록";deletePlaceBtn.hidden=true;
 placeTypeEdit.value="국내";placeStatusEdit.value="방문";populatePlaceNames("국내");
 placeStartEdit.value=fmt(new Date());placeEndEdit.value="";
}
function newPlace(){resetPlaceForm();openModal("placeModal")}
function editPlace(id){
 const x=places.find(v=>v.id===id);if(!x)return;
 placeEditId.value=x.id;placeTypeEdit.value=x.place_type;placeStatusEdit.value=x.status;
 const legacyRegion=x.region_name||((x.place_type==="국내"&&PLACE_PRESETS["국내"][x.place_name])?x.place_name:"");
 const legacyCities=placeCities(x);
 if(!legacyCities.length&&x.place_type==="국내"&&!legacyRegion&&x.place_name)legacyCities.push(x.place_name);
 populatePlaceNames(x.place_type,x.place_type==="국내"?legacyRegion:x.place_name,legacyCities);
 placeStartEdit.value=x.start_date||"";placeEndEdit.value=x.end_date||"";placeAuthorEdit.value=x.author_name||"";placeMemoEdit.value=x.memo||"";
 placeModalTitle.textContent="방문지 수정";deletePlaceBtn.hidden=false;openModal("placeModal");
}
placeTypeEdit.onchange=()=>populatePlaceNames(placeTypeEdit.value);
placeNameEdit.onchange=()=>populatePlaceCities(placeNameEdit.value);
placeCitySelectAll.onclick=()=>placeCityEdit.querySelectorAll('input[type="checkbox"]').forEach(el=>el.checked=true);
placeCityClear.onclick=()=>placeCityEdit.querySelectorAll('input[type="checkbox"]').forEach(el=>el.checked=false);
placeFormPublic.onsubmit=async e=>{
 e.preventDefault();clearFormError("placeFormPublic");
 const existing=placeEditId.value;const id=existing?Number(existing):null;
 const type=placeTypeEdit.value;
 const region=type==="국내"?placeNameEdit.value:"";
 const cities=selectedPlaceCities();
 if(!cities.length){showFormError("placeFormPublic",new Error(type==="국내"?"방문한 도시·군·구를 하나 이상 선택해 주세요.":"방문한 해외 도시·지역을 하나 이상 선택해 주세요."));return}
 const city=cities[0]||"";
 const name=type==="국내"?(city||region):placeNameEdit.value;
 const coord=type==="국내"?(KR_CITY_COORDS[city]||(PLACE_PRESETS["국내"]||{})[region]):(PLACE_PRESETS["해외"]||{})[name];
 if(!coord)return;
 const now=new Date().toISOString();
 const startDate=placeStartEdit.value||null,endDate=placeEndEdit.value||startDate;
 if(startDate&&endDate&&endDate<startDate){showFormError("placeFormPublic",new Error("종료일은 방문/계획일보다 빠를 수 없습니다."));return}
 const p={place_type:type,status:placeStatusEdit.value,place_name:name,region_name:region,city_name:city,city_names:cities,latitude:coord[0],longitude:coord[1],start_date:startDate,end_date:endDate,author_name:placeAuthorEdit.value.trim(),memo:placeMemoEdit.value.trim(),updated_at:now};
 try{
  let saved;
  if(id&&id>0) saved=await apiData("travel_places","PUT",p,id);
  else saved=await apiData("travel_places","POST",{...p,created_at:now});
  if(id) localDelete("places",id);
  if(saved) localUpsert("places",saved);
  closeModal("placeModal");
  toast(existing?"방문지가 수정·동기화되었습니다.":"방문지가 저장·동기화되었습니다.");
  await loadAll();
 }catch(err){console.error("travel_places save failed:",err);showFormError("placeFormPublic",err)}
}
deletePlaceBtn.onclick=async()=>{
 const id=Number(placeEditId.value);if(!id||!confirm("이 방문지 기록을 삭제하시겠습니까?"))return;
 clearFormError("placeFormPublic");
 try{
  if(id>0) await apiData("travel_places","DELETE",null,id);
  localDelete("places",id);closeModal("placeModal");toast("방문지가 삭제·동기화되었습니다.");await loadAll();
 }catch(err){console.error("travel_places delete failed:",err);showFormError("placeFormPublic",err)}
}
async function migrateLegacyPlacesInBackground(){
 try{
  const legacy=legacyLocalRows("places");if(!legacy.length)return;let moved=0;
  for(const row of legacy){
   const q={...row};delete q.id;q.created_at=q.created_at||new Date().toISOString();q.updated_at=new Date().toISOString();
   try{const saved=await apiData("travel_places","POST",q);if(saved){localDelete("places",row.id);moved++}}catch(err){console.warn("Legacy place sync skipped:",err)}
  }
  if(moved){toast(`PC에만 있던 방문지 ${moved}건을 동기화했습니다.`);await loadAll()}
 }catch(err){console.warn("Legacy place background migration skipped:",err)}
}
placeTypeFilter.onchange=renderPlaces;placeStatusFilter.onchange=renderPlaces;placeSearch.oninput=renderPlaces;
openPlaceCreate.onclick=newPlace;

function renderBoard(){
 const q=boardSearch.value.toLowerCase(),type=boardType.value,status=boardStatus.value;
 const list=trips.filter(x=>(!type||x.trip_type===type)&&(!status||x.status===status)&&(`${x.title} ${x.city||""} ${x.country||""} ${x.region||""}`.toLowerCase().includes(q)));
 tripBoard.innerHTML=list.length?list.map(x=>`<div class="board-row" data-trip="${x.id}"><span>${esc(x.trip_type)}</span><span>${esc(x.trip_type==="국내"?(regionLabel(normalizeRegionKey(x.region))+(x.city?` · ${x.city}`:"")):((x.country||"-")+(x.city?` · ${x.city}`:"")))}</span><b>${esc(x.title)}${x.author_name?` <small class="author-note">by ${esc(x.author_name)}</small>`:""}</b><time>${x.start_date||""}${x.end_date?` ~ ${x.end_date}`:""}</time><span class="status-chip ${x.status==="버킷리스트"?"bucket":x.status==="완료"?"done":""}">${esc(x.status||"예정")}</span></div>`).join(""):'<div class="empty-mini">조건에 맞는 여행이 없습니다.</div>';
 $$("#tripBoard [data-trip]").forEach(el=>el.onclick=()=>editTrip(Number(el.dataset.trip)));
}
boardSearch.oninput=renderBoard;boardType.onchange=renderBoard;boardStatus.onchange=renderBoard;
function renderBudgetOptions(){const options=trips.map(x=>`<option value="${x.id}">${esc(x.title)}</option>`).join("");budgetTripSelect.innerHTML=`<option value="">전체 여행</option>${options}`;if(selectedBudgetTrip)budgetTripSelect.value=selectedBudgetTrip}
function renderBudget(){
 const id=budgetTripSelect.value;selectedBudgetTrip=id;const list=budgets.filter(x=>!id||String(x.trip_id)===String(id)),total=list.reduce((s,x)=>s+Number(x.budget_amount||0),0),spent=list.reduce((s,x)=>s+Number(x.spent_amount||0),0),remain=total-spent,rate=total?Math.round(spent/total*100):0;
 budgetTotal.textContent=money(total);budgetSpent.textContent=money(spent);budgetRemain.textContent=money(remain);budgetRate.textContent=rate+"%";
 budgetTable.innerHTML=`<div class="budget-row head"><span>항목</span><span>예산</span><span>지출</span><span>잔액</span></div>`+(list.length?list.map(x=>`<div class="budget-row" data-budget="${x.id}"><b>${esc(x.category)}${x.author_name?` <small class="author-note">by ${esc(x.author_name)}</small>`:""}</b><span>${money(x.budget_amount)}</span><span>${money(x.spent_amount)}</span><span>${money(Number(x.budget_amount)-Number(x.spent_amount))}</span></div>`).join(""):'<div class="empty-mini">등록된 예산이 없습니다.</div>');
 $$("#budgetTable [data-budget]").forEach(el=>el.onclick=()=>editBudget(Number(el.dataset.budget)));
}
budgetTripSelect.onchange=renderBudget;
function fillEditTripSelects(){const o='<option value="">미지정</option>'+trips.map(x=>`<option value="${x.id}">${esc(x.title)}</option>`).join("");eventTripEdit.innerHTML=o;budgetTripEdit.innerHTML=o}

/* 여행 CRUD */
function resetTripForm(){
 tripFormPublic.reset();tripEditId.value="";deleteTripBtn.hidden=true;tripModalTitle.textContent="여행 추가";
 tripStatusEdit.value="예정";tripTypeEdit.value="국내";tripCountryEdit.value="대한민국";
 syncTripLocationFields("","","대한민국");
}
function newTrip(){resetTripForm();openModal("tripModal")}
function editTrip(id){
 const x=trips.find(v=>v.id===id);if(!x)return;
 tripEditId.value=x.id;tripTypeEdit.value=x.trip_type;tripStatusEdit.value=x.status;tripTitleEdit.value=x.title;
 tripStartEdit.value=x.start_date||"";tripEndEdit.value=x.end_date||"";
 const editCountry=x.country|| (x.trip_type==="국내"?"대한민국":"");
 syncTripLocationFields(x.region||"",x.city||"",editCountry);
 tripMemoEdit.value=x.memo||"";tripAuthorEdit.value=x.author_name||"";
 tripModalTitle.textContent="여행 수정";deleteTripBtn.hidden=false;openModal("tripModal");
}
tripTypeEdit.onchange=()=>syncTripLocationFields("","",tripTypeEdit.value==="국내"?"대한민국":"");
tripRegionEdit.onchange=()=>populateTripCities(tripRegionEdit.value,"");
tripCountryEdit.onchange=()=>{if(tripTypeEdit.value==="해외")populateTripCities(tripCountryEdit.value,"")};
tripFormPublic.onsubmit=async e=>{
 e.preventDefault();clearFormError("tripFormPublic");
 const existing=tripEditId.value;const id=existing?Number(existing):null;
 const tripStart=tripStartEdit.value||null,tripEnd=tripEndEdit.value||tripStart;
 if(tripStart&&tripEnd&&tripEnd<tripStart){showFormError("tripFormPublic",new Error("종료일은 시작일보다 빠를 수 없습니다."));return}
 const tripRegion=tripTypeEdit.value==="국내"?normalizeRegionKey(tripRegionEdit.value):"";
 const tripCity=tripCityEdit.value;
 const tripCountry=tripTypeEdit.value==="국내"?"대한민국":tripCountryEdit.value.trim();
 if(tripTypeEdit.value==="국내"&&!tripRegion){showFormError("tripFormPublic",new Error("국내 지역을 선택해 주세요."));return}
 if(tripTypeEdit.value==="국내"&&!METRO_REGIONS.has(tripRegion)&&!tripCity){showFormError("tripFormPublic",new Error("도시를 선택해 주세요."));return}
 if(tripTypeEdit.value==="해외"&&!tripCountry){showFormError("tripFormPublic",new Error("국가를 선택해 주세요."));return}
 if(tripTypeEdit.value==="해외"&&!tripCity){showFormError("tripFormPublic",new Error("해외 도시·지역을 선택해 주세요."));return}
 const p={trip_type:tripTypeEdit.value,status:tripStatusEdit.value,title:tripTitleEdit.value.trim(),start_date:tripStart,end_date:tripEnd,region:tripRegion,city:tripCity,country:tripCountry,memo:tripMemoEdit.value.trim(),author_name:tripAuthorEdit.value.trim(),is_visible:true,updated_at:new Date().toISOString()};
 try{
  const saved=(id&&id>0)?await apiData("travel_trips","PUT",p,id):await apiData("travel_trips","POST",p);
  if(id)localDelete("trips",id);if(saved)localUpsert("trips",saved);
  closeModal("tripModal");toast(existing?"여행이 수정·동기화되었습니다.":"여행이 저장·동기화되었습니다.");await loadAll();
 }catch(err){showFormError("tripFormPublic",err)}
}
deleteTripBtn.onclick=async()=>{
 const id=Number(tripEditId.value);if(!id||!confirm("이 여행과 연결된 일정·예산까지 삭제될 수 있습니다. 정말 삭제하시겠습니까?"))return;
 try{if(id>0)await apiData("travel_trips","DELETE",null,id);localDelete("trips",id);closeModal("tripModal");toast("여행이 삭제·동기화되었습니다.");await loadAll()}catch(err){showFormError("tripFormPublic",err)}
}

/* 일정 CRUD */
function resetEventForm(){eventFormPublic.reset();eventEditId.value="";deleteEventBtn.hidden=true;eventModalTitle.textContent="일정 추가";eventCategoryEdit.value="일정";eventDateEdit.value=selectedDate||fmt(new Date())}
function newEvent(){resetEventForm();openModal("eventModal")}
function editEvent(id){const x=events.find(v=>v.id===id);if(!x)return;eventEditId.value=x.id;eventTripEdit.value=x.trip_id||"";eventDateEdit.value=x.event_date;eventCategoryEdit.value=x.category||"일정";eventTitleEdit.value=x.title;eventDescEdit.value=x.description||"";eventAuthorEdit.value=x.author_name||"";eventModalTitle.textContent="일정 수정";deleteEventBtn.hidden=false;openModal("eventModal")}
eventFormPublic.onsubmit=async e=>{
 e.preventDefault();clearFormError("eventFormPublic");
 const existing=eventEditId.value;const id=existing?Number(existing):null;
 const p={trip_id:eventTripEdit.value?Number(eventTripEdit.value):null,event_date:eventDateEdit.value,category:eventCategoryEdit.value.trim()||"일정",title:eventTitleEdit.value.trim(),description:eventDescEdit.value.trim(),author_name:eventAuthorEdit.value.trim(),is_visible:true,updated_at:new Date().toISOString()};
 try{
  const saved=(id&&id>0)?await apiData("travel_events","PUT",p,id):await apiData("travel_events","POST",p);
  if(id)localDelete("events",id);if(saved)localUpsert("events",saved);selectedDate=eventDateEdit.value;
  closeModal("eventModal");toast(existing?"일정이 수정·동기화되었습니다.":"일정이 저장·동기화되었습니다.");await loadAll();
 }catch(err){showFormError("eventFormPublic",err)}
}
deleteEventBtn.onclick=async()=>{
 const id=Number(eventEditId.value);if(!id||!confirm("이 일정을 삭제하시겠습니까?"))return;
 try{if(id>0)await apiData("travel_events","DELETE",null,id);localDelete("events",id);closeModal("eventModal");toast("일정이 삭제·동기화되었습니다.");await loadAll()}catch(err){showFormError("eventFormPublic",err)}
}

/* 예산 CRUD */
function resetBudgetForm(){budgetFormPublic.reset();budgetEditId.value="";deleteBudgetBtn.hidden=true;budgetModalTitle.textContent="예산 추가"}
function newBudget(){resetBudgetForm();budgetTripEdit.value=budgetTripSelect.value||"";openModal("budgetModal")}
function editBudget(id){const x=budgets.find(v=>v.id===id);if(!x)return;budgetEditId.value=x.id;budgetTripEdit.value=x.trip_id||"";budgetCategoryEdit.value=x.category;budgetAmountEdit.value=x.budget_amount||0;budgetSpentEdit.value=x.spent_amount||0;budgetAuthorEdit.value=x.author_name||"";budgetModalTitle.textContent="예산 수정";deleteBudgetBtn.hidden=false;openModal("budgetModal")}
budgetFormPublic.onsubmit=async e=>{
 e.preventDefault();clearFormError("budgetFormPublic");
 const existing=budgetEditId.value;const id=existing?Number(existing):null;
 const p={trip_id:budgetTripEdit.value?Number(budgetTripEdit.value):null,category:budgetCategoryEdit.value,budget_amount:Number(budgetAmountEdit.value)||0,spent_amount:Number(budgetSpentEdit.value)||0,author_name:budgetAuthorEdit.value.trim(),sort_order:100,updated_at:new Date().toISOString()};
 try{
  const saved=(id&&id>0)?await apiData("travel_budgets","PUT",p,id):await apiData("travel_budgets","POST",p);
  if(id)localDelete("budgets",id);if(saved)localUpsert("budgets",saved);closeModal("budgetModal");toast(existing?"예산이 수정·동기화되었습니다.":"예산이 저장·동기화되었습니다.");await loadAll();
 }catch(err){showFormError("budgetFormPublic",err)}
}
deleteBudgetBtn.onclick=async()=>{
 const id=Number(budgetEditId.value);if(!id||!confirm("이 예산 항목을 삭제하시겠습니까?"))return;
 try{if(id>0)await apiData("travel_budgets","DELETE",null,id);localDelete("budgets",id);closeModal("budgetModal");toast("예산이 삭제·동기화되었습니다.");await loadAll()}catch(err){showFormError("budgetFormPublic",err)}
}

openTripCreate.onclick=newTrip;openTripCreate2.onclick=newTrip;openEventCreate.onclick=newEvent;openBudgetCreate.onclick=newBudget;
const NAV_IDS=["home","calendar","korea","world","places","board","budget"];
let __activeNavId="home";
let __lastNavScrollY=Math.max(0,window.scrollY);
let __navManualLockUntil=0;
function setActiveNav(id){
 __activeNavId=id||__activeNavId;
 $$(".nav a").forEach(a=>a.classList.toggle("active",a.dataset.target===__activeNavId));
}
function navSectionIndexAtDocumentY(documentY){
 let candidate=0;
 for(let i=0;i<NAV_IDS.length;i++){
  const el=document.getElementById(NAV_IDS[i]);
  if(!el)continue;
  const top=el.getBoundingClientRect().top+window.scrollY;
  if(top<=documentY) candidate=i;
  else break;
 }
 return candidate;
}
function updateActiveNav(){
 const y=Math.max(0,window.scrollY);
 if(Date.now()<__navManualLockUntil){__lastNavScrollY=y;return;}
 const delta=y-__lastNavScrollY;
 const scrollingUp=delta<-1;
 const scrollingDown=delta>1;
 __lastNavScrollY=y;
 const desktop=window.innerWidth>820;
 const viewportH=Math.max(1,window.innerHeight);
 const doc=document.documentElement;
 const maxScroll=Math.max(0,doc.scrollHeight-viewportH);
 const distanceToBottom=Math.max(0,maxScroll-y);

 // 핵심: 화면 안의 '판정선'을 실제로 점유한 섹션을 현재 위치로 봅니다.
 // 아래로 갈 때는 약 36% 지점, 위로 올릴 때는 약 62% 지점에서 판정합니다.
 // 따라서 위로 올릴 때는 이전 섹션이 화면 대부분을 차지하기 전까지 현재 메뉴가 유지됩니다.
 const focusRatio=desktop?(scrollingUp?0.62:scrollingDown?0.36:0.48):(scrollingUp?0.56:scrollingDown?0.34:0.46);
 const focusDocumentY=y+viewportH*focusRatio;
 let candidate=navSectionIndexAtDocumentY(focusDocumentY);

 // 마지막 섹션은 문서 끝 때문에 제목이 판정선까지 올라오지 못할 수 있습니다.
 // 실제 최하단에 도달하면 반드시 '예산'을 현재 위치로 표시합니다.
 if(distanceToBottom<=Math.max(18,viewportH*0.025)) candidate=NAV_IDS.length-1;

 // 맨 위에서는 홈을 확실하게 유지합니다.
 if(y<=4) candidate=0;

 setActiveNav(NAV_IDS[candidate]);
}
$$(".nav a,.quick-grid a").forEach(a=>a.onclick=e=>{
 const id=(a.dataset.target||a.getAttribute("href")?.replace("#",""));
 if(id&&document.getElementById(id)){
  e.preventDefault();
  __navManualLockUntil=Date.now()+900;
  setActiveNav(id);
  document.getElementById(id).scrollIntoView({behavior:"smooth",block:"start"});
 }
});
function runGlobalSearch(){
 const q=globalSearch.value.trim().toLowerCase();if(!q){globalSearch.focus();return;}
 boardSearch.value=q;renderBoard();__navManualLockUntil=Date.now()+900;setActiveNav("board");document.getElementById("board").scrollIntoView({behavior:"smooth"});
}
globalSearchBtn.onclick=runGlobalSearch;
globalSearch.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();runGlobalSearch()}});
const heroSearchBox=document.querySelector('.hero-search');
heroSearchBox?.addEventListener('click',e=>{if(e.target===heroSearchBox||e.target===heroSearchBox.querySelector('span'))globalSearch.focus()});
let __navRaf=0;
addEventListener("scroll",()=>{if(__navRaf)return;__navRaf=requestAnimationFrame(()=>{__navRaf=0;updateActiveNav()})},{passive:true});
addEventListener("resize",updateActiveNav,{passive:true});
loadAll().then(async()=>{await migrateLegacyPlacesInBackground();startAutoSync();updateActiveNav();});

window.addEventListener("unhandledrejection",e=>{console.warn("Background sync failed",e.reason);e.preventDefault();});
