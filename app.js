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
 try{payload=await res.json()}catch(_){payload={}}
 if(!res.ok||payload.error) throw new Error(payload.error||`동기화 서버 오류 (HTTP ${res.status})`);
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
  const data=await apiData("all");
  const fp=snapshotFingerprint(data);
  if(fp===__serverFingerprint) return;
  __serverFingerprint=fp;applyServerSnapshot(data);renderAll();
 }catch(err){console.warn("Quiet sync skipped:",err)}
}
function startAutoSync(){
 clearInterval(window.__travelSyncTimer);
 window.__travelSyncTimer=setInterval(quietSync,5000);
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

const KR_HOLIDAYS_2026={
 "2026-01-01":"신정",
 "2026-02-16":"설날 연휴","2026-02-17":"설날","2026-02-18":"설날 연휴",
 "2026-03-01":"삼일절","2026-03-02":"대체공휴일",
 "2026-05-05":"어린이날","2026-05-24":"부처님오신날","2026-05-25":"대체공휴일",
 "2026-06-03":"지방선거일","2026-06-06":"현충일",
 "2026-08-15":"광복절","2026-08-17":"대체공휴일",
 "2026-09-24":"추석 연휴","2026-09-25":"추석","2026-09-26":"추석 연휴",
 "2026-10-03":"개천절","2026-10-05":"대체공휴일","2026-10-09":"한글날",
 "2026-12-25":"성탄절"
};

let koreaMap=null,worldMap=null,koreaMapMarkers=[],worldMapMarkers=[];


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
  const data=await apiData("all");
  __serverFingerprint=snapshotFingerprint(data);
  applyServerSnapshot(data);
 }catch(err){
  console.warn("Server sync unavailable; using local cache.",err);
  trips=localTrips;events=localEvents;budgets=localBudgets;places=localPlaces;
 }
 renderAll();
}
function renderAll(){renderHero();renderUpcoming();renderCalendar();renderKorea();renderWorld();renderPlaces();renderBoard();renderBudgetOptions();renderBudget();fillEditTripSelects()}
function renderHero(){
 const now=new Date(),future=trips.filter(x=>x.start_date&&new Date(x.start_date+"T00:00:00")>=new Date(now.toDateString())).sort((a,b)=>a.start_date.localeCompare(b.start_date));
 const next=future[0];
 sideNextTrip.textContent=next?.title||"아직 예정 여행이 없습니다";
 sideNextDates.textContent=next?`${next.start_date} ~ ${next.end_date||next.start_date}`:"새 여행을 등록해 보세요.";
 if(next){const d=Math.ceil((new Date(next.start_date+"T00:00:00")-new Date(now.toDateString()))/86400000);sideNextDday.textContent=d>=0?`D-${d}`:"여행중"}else sideNextDday.textContent="READY";
 statTrips.textContent=trips.length;
 statCities.textContent=new Set(trips.map(x=>x.city).filter(Boolean)).size;
 statCountries.textContent=new Set(trips.filter(x=>x.trip_type==="해외").map(x=>x.country).filter(Boolean)).size;
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
function renderCalendar(){
 const y=cal.getFullYear(),m=cal.getMonth();monthTitle.textContent=`${y}년 ${m+1}월`;
 const first=new Date(y,m,1),start=new Date(y,m,1-first.getDay()),today=fmt(new Date());
 let html="";
 for(let i=0;i<42;i++){
   const d=new Date(start);d.setDate(start.getDate()+i);
   const k=fmt(d),dow=d.getDay(),holiday=KR_HOLIDAYS_2026[k]||"";
   const has=events.some(x=>x.event_date===k)||trips.some(x=>x.start_date===k||x.end_date===k);
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
 $$(".day").forEach(b=>b.onclick=()=>{selectedDate=b.dataset.date;renderCalendar();renderDay()});
 renderDay();
}
function renderDay(){
 const list=[...events.filter(x=>x.event_date===selectedDate).map(x=>({id:x.id,kind:"event",type:x.category||"일정",title:x.title,sub:x.description||"",author:x.author_name||""})),
 ...trips.filter(x=>x.start_date===selectedDate).map(x=>({id:x.id,kind:"trip",type:"출발",title:x.title,sub:x.city||x.country||"",author:x.author_name||""})),
 ...trips.filter(x=>x.end_date===selectedDate).map(x=>({id:x.id,kind:"trip",type:"귀국",title:x.title,sub:x.city||x.country||"",author:x.author_name||""}))];
 dayTitle.textContent=selectedDate?`${Number(selectedDate.slice(5,7))}월 ${Number(selectedDate.slice(8,10))}일 일정`:"선택 날짜 일정";dayCount.textContent=`${list.length}건`;
 dayEvents.innerHTML=list.length?list.map(x=>`<div class="day-event" data-kind="${x.kind}" data-id="${x.id}"><time>${esc(x.type)}</time><div><strong>${esc(x.title)}</strong><small>${esc(x.sub)}${x.author?` · 작성 ${esc(x.author)}`:""}</small></div></div>`).join(""):'<div class="empty">날짜를 선택하면 해당 일정이 표시됩니다.</div>';
 $$("#dayEvents .day-event").forEach(el=>el.onclick=()=>el.dataset.kind==="event"?editEvent(Number(el.dataset.id)):editTrip(Number(el.dataset.id)));
}
prevMonth.onclick=()=>{cal.setMonth(cal.getMonth()-1);renderCalendar()};nextMonth.onclick=()=>{cal.setMonth(cal.getMonth()+1);renderCalendar()};todayMonth.onclick=()=>{cal=new Date();renderCalendar()};
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
}
function clearMapMarkers(list){list.forEach(x=>x.remove());list.length=0}
function markerElement(status){
 const el=document.createElement("button");
 el.type="button";
 el.className=`place-marker ${status==="방문"?"visited":"bucket"}`;
 el.title=status;
 return el;
}
function renderKorea(){
 ensureKoreaMap();
 if(!koreaMap) return;
 clearMapMarkers(koreaMapMarkers);
 const rows=places.filter(x=>x.place_type==="국내");
 rows.forEach(x=>{
   const el=markerElement(x.status);
   const marker=new maplibregl.Marker({element:el,anchor:"center"})
     .setLngLat([Number(x.longitude),Number(x.latitude)])
     .addTo(koreaMap);
   el.addEventListener("click",()=>{
     koreaRegion.textContent=x.place_name;
     koreaDesc.textContent=`${x.status}${x.author_name?` · 작성 ${x.author_name}`:""}${x.memo?` · ${x.memo}`:""}`;
     koreaTripList.innerHTML=`<div class="mini-trip"><b>${esc(x.place_name)}</b><small>${esc(x.status)}${x.author_name?` · ${esc(x.author_name)}`:""}</small></div>`;
   });
   koreaMapMarkers.push(marker);
 });
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
}
function renderWorld(){
 ensureWorldMap();
 if(!worldMap) return;
 clearMapMarkers(worldMapMarkers);
 const rows=places.filter(x=>x.place_type==="해외");
 rows.forEach(x=>{
   const el=markerElement(x.status);
   const marker=new maplibregl.Marker({element:el,anchor:"center"})
     .setLngLat([Number(x.longitude),Number(x.latitude)])
     .addTo(worldMap);
   el.addEventListener("click",()=>{
     worldCountry.textContent=x.place_name;
     worldDesc.textContent=`${x.status}${x.author_name?` · 작성 ${x.author_name}`:""}${x.memo?` · ${x.memo}`:""}`;
     worldTripList.innerHTML=`<div class="mini-trip"><b>${esc(x.place_name)}</b><small>${esc(x.status)}${x.author_name?` · ${esc(x.author_name)}`:""}</small></div>`;
   });
   worldMapMarkers.push(marker);
 });
 setTimeout(()=>worldMap.resize(),120);
}


function populatePlaceNames(type,current=""){
 const names=Object.keys(PLACE_PRESETS[type]||{});
 placeNameEdit.innerHTML=names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("");
 if(current&&names.includes(current)) placeNameEdit.value=current;
}
function renderPlaces(){
 const dv=places.filter(x=>x.place_type==="국내"&&x.status==="방문").length;
 const db=places.filter(x=>x.place_type==="국내"&&x.status==="버킷리스트").length;
 const ov=places.filter(x=>x.place_type==="해외"&&x.status==="방문").length;
 const ob=places.filter(x=>x.place_type==="해외"&&x.status==="버킷리스트").length;
 domesticVisitedCount.textContent=dv;domesticBucketCount.textContent=db;overseasVisitedCount.textContent=ov;overseasBucketCount.textContent=ob;

 const q=placeSearch.value.trim().toLowerCase(),type=placeTypeFilter.value,status=placeStatusFilter.value;
 const rows=places.filter(x=>(!type||x.place_type===type)&&(!status||x.status===status)&&(`${x.place_name} ${x.memo||""} ${x.author_name||""}`.toLowerCase().includes(q)));
 placeList.innerHTML=rows.length?rows.map(x=>`<div class="place-row" data-place="${x.id}">
   <span>${esc(x.place_type)}</span>
   <span class="place-status ${x.status==="방문"?"visited":"bucket"}">${esc(x.status)}</span>
   <b>${esc(x.place_name)}</b>
   <small class="place-memo">${esc(x.memo||"-")}</small>
   <small class="place-author">${esc(x.author_name||"-")}</small>
 </div>`).join(""):'<div class="empty-mini">등록된 방문지가 없습니다.</div>';
 $$("#placeList [data-place]").forEach(el=>el.onclick=()=>editPlace(Number(el.dataset.place)));
}
function resetPlaceForm(){
 placeFormPublic.reset();placeEditId.value="";placeModalTitle.textContent="방문지 등록";deletePlaceBtn.hidden=true;
 placeTypeEdit.value="국내";placeStatusEdit.value="방문";populatePlaceNames("국내");
}
function newPlace(){resetPlaceForm();openModal("placeModal")}
function editPlace(id){
 const x=places.find(v=>v.id===id);if(!x)return;
 placeEditId.value=x.id;placeTypeEdit.value=x.place_type;placeStatusEdit.value=x.status;
 populatePlaceNames(x.place_type,x.place_name);placeAuthorEdit.value=x.author_name||"";placeMemoEdit.value=x.memo||"";
 placeModalTitle.textContent="방문지 수정";deletePlaceBtn.hidden=false;openModal("placeModal");
}
placeTypeEdit.onchange=()=>populatePlaceNames(placeTypeEdit.value);
placeFormPublic.onsubmit=async e=>{
 e.preventDefault();clearFormError("placeFormPublic");
 const existing=placeEditId.value;const id=existing?Number(existing):null;
 const type=placeTypeEdit.value,name=placeNameEdit.value,coord=(PLACE_PRESETS[type]||{})[name];
 if(!coord)return;
 const now=new Date().toISOString();
 const p={place_type:type,status:placeStatusEdit.value,place_name:name,latitude:coord[0],longitude:coord[1],author_name:placeAuthorEdit.value.trim(),memo:placeMemoEdit.value.trim(),updated_at:now};
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
 tripBoard.innerHTML=list.length?list.map(x=>`<div class="board-row" data-trip="${x.id}"><span>${esc(x.trip_type)}</span><span>${esc(x.region||x.country||"-")}</span><b>${esc(x.title)}${x.author_name?` <small class="author-note">by ${esc(x.author_name)}</small>`:""}</b><time>${x.start_date||""}${x.end_date?` ~ ${x.end_date}`:""}</time><span class="status-chip ${x.status==="버킷리스트"?"bucket":x.status==="완료"?"done":""}">${esc(x.status||"예정")}</span></div>`).join(""):'<div class="empty-mini">조건에 맞는 여행이 없습니다.</div>';
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
function resetTripForm(){tripFormPublic.reset();tripEditId.value="";deleteTripBtn.hidden=true;tripModalTitle.textContent="여행 추가";tripStatusEdit.value="예정";tripTypeEdit.value="국내"}
function newTrip(){resetTripForm();openModal("tripModal")}
function editTrip(id){const x=trips.find(v=>v.id===id);if(!x)return;tripEditId.value=x.id;tripTypeEdit.value=x.trip_type;tripStatusEdit.value=x.status;tripTitleEdit.value=x.title;tripStartEdit.value=x.start_date||"";tripEndEdit.value=x.end_date||"";tripRegionEdit.value=x.region||"";tripCityEdit.value=x.city||"";tripCountryEdit.value=x.country||"";tripMemoEdit.value=x.memo||"";tripAuthorEdit.value=x.author_name||"";tripModalTitle.textContent="여행 수정";deleteTripBtn.hidden=false;openModal("tripModal")}
tripFormPublic.onsubmit=async e=>{
 e.preventDefault();clearFormError("tripFormPublic");
 const existing=tripEditId.value;const id=existing?Number(existing):null;
 const p={trip_type:tripTypeEdit.value,status:tripStatusEdit.value,title:tripTitleEdit.value.trim(),start_date:tripStartEdit.value||null,end_date:tripEndEdit.value||null,region:tripRegionEdit.value.trim(),city:tripCityEdit.value.trim(),country:tripCountryEdit.value.trim(),memo:tripMemoEdit.value.trim(),author_name:tripAuthorEdit.value.trim(),is_visible:true,updated_at:new Date().toISOString()};
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
$$(".nav a,.quick-grid a").forEach(a=>a.onclick=e=>{const id=(a.dataset.target||a.getAttribute("href")?.replace("#",""));if(id&&document.getElementById(id)){e.preventDefault();document.getElementById(id).scrollIntoView({behavior:"smooth"})}});
globalSearchBtn.onclick=()=>{const q=globalSearch.value.trim().toLowerCase();if(!q)return;boardSearch.value=q;renderBoard();document.getElementById("board").scrollIntoView({behavior:"smooth"})};
const ids=["home","calendar","korea","world","places","board","budget"];addEventListener("scroll",()=>{let cur="home";ids.forEach(id=>{const el=document.getElementById(id);if(el&&el.getBoundingClientRect().top<140)cur=id});$$(".nav a").forEach(a=>a.classList.toggle("active",a.dataset.target===cur))},{passive:true});
loadAll().then(async()=>{await migrateLegacyPlacesInBackground();startAutoSync();});

window.addEventListener("unhandledrejection",e=>{console.warn("Background sync failed",e.reason);e.preventDefault();});
