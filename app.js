const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const cfg=window.TRAVEL_CONFIG||{};
const sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
const esc=(s="")=>String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const money=n=>"₩"+Number(n||0).toLocaleString("ko-KR");
let trips=[],events=[],budgets=[],regions=[],worldPlaces=[];
let cal=new Date(),selectedDate="",selectedBudgetTrip="";

async function loadAll(){
 const [t,e,b,r,w]=await Promise.all([
  sb.from("travel_trips").select("*").eq("is_visible",true).order("start_date"),
  sb.from("travel_events").select("*").eq("is_visible",true).order("event_date"),
  sb.from("travel_budgets").select("*").order("sort_order"),
  sb.from("travel_regions").select("*").eq("is_visible",true),
  sb.from("travel_world_places").select("*").eq("is_visible",true)
 ]);
 trips=t.data||[];events=e.data||[];budgets=b.data||[];regions=r.data||[];worldPlaces=w.data||[];
 renderAll();
}
function renderAll(){renderHero();renderUpcoming();renderCalendar();renderKorea();renderWorld();renderBoard();renderBudgetOptions();renderBudget()}
function renderHero(){
 const now=new Date(),future=trips.filter(x=>x.start_date&&new Date(x.start_date+"T00:00:00")>=new Date(now.toDateString())).sort((a,b)=>a.start_date.localeCompare(b.start_date));
 const next=future[0];
 sideNextTrip.textContent=next?.title||"아직 예정 여행이 없습니다";
 sideNextDates.textContent=next?`${next.start_date} ~ ${next.end_date||next.start_date}`:"새 여행을 등록해 보세요.";
 if(next){const d=Math.ceil((new Date(next.start_date+"T00:00:00")-new Date(now.toDateString()))/86400000);sideNextDday.textContent=d>=0?`D-${d}`:"여행중"} else sideNextDday.textContent="READY";
 statTrips.textContent=trips.length;
 statCities.textContent=new Set(trips.map(x=>x.city).filter(Boolean)).size;
 statCountries.textContent=new Set(trips.filter(x=>x.trip_type==="해외").map(x=>x.country).filter(Boolean)).size;
 const total=budgets.reduce((s,x)=>s+Number(x.budget_amount||0),0),spent=budgets.reduce((s,x)=>s+Number(x.spent_amount||0),0),rate=total?Math.round(spent/total*100):0;
 heroBudget.textContent=money(total);heroBudgetDetail.textContent=`지출 ${money(spent)} / ${rate}%`;budgetProgress.style.width=Math.min(rate,100)+"%";
}
function renderUpcoming(){
 const now=new Date(),future=trips.filter(x=>x.start_date&&new Date(x.start_date+"T00:00:00")>=new Date(now.toDateString())).slice(0,4);
 upcomingTrips.innerHTML=future.length?future.map(x=>{const d=Math.ceil((new Date(x.start_date+"T00:00:00")-new Date(now.toDateString()))/86400000);return `<div><time>${x.start_date.slice(5).replace("-",".")}</time><p><b>${esc(x.title)}</b><small>${esc(x.city||x.country||"")} · ${esc(x.trip_type)}</small></p><span>${d>=0?`D-${d}`:"NOW"}</span></div>`}).join(""):'<div class="empty-mini">예정된 여행이 없습니다.</div>';
 const cats=["교통","숙박","식비","관광·쇼핑"];budgetMini.innerHTML=cats.map(c=>{const sum=budgets.filter(x=>x.category===c).reduce((s,x)=>s+Number(x.budget_amount||0),0);return `<div><span>${c}</span><strong>${money(sum)}</strong></div>`}).join("");
}
function fmt(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function renderCalendar(){
 const y=cal.getFullYear(),m=cal.getMonth();monthTitle.textContent=`${y}년 ${m+1}월`;
 const first=new Date(y,m,1),start=new Date(y,m,1-first.getDay()),today=fmt(new Date());
 let html="";
 for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const k=fmt(d),has=events.some(x=>x.event_date===k)||trips.some(x=>x.start_date===k||x.end_date===k);html+=`<button class="day ${d.getMonth()!==m?"other":""} ${k===today?"today":""} ${k===selectedDate?"selected":""} ${has?"has-event":""}" data-date="${k}">${d.getDate()}</button>`}
 calendarGrid.innerHTML=html;$$(".day").forEach(b=>b.onclick=()=>{selectedDate=b.dataset.date;renderCalendar();renderDay()});renderDay();
}
function renderDay(){
 const list=[...events.filter(x=>x.event_date===selectedDate).map(x=>({type:x.category||"일정",title:x.title,sub:x.description||""})),
 ...trips.filter(x=>x.start_date===selectedDate).map(x=>({type:"출발",title:x.title,sub:x.city||x.country||""})),
 ...trips.filter(x=>x.end_date===selectedDate).map(x=>({type:"귀국",title:x.title,sub:x.city||x.country||""}))];
 dayTitle.textContent=selectedDate?`${Number(selectedDate.slice(5,7))}월 ${Number(selectedDate.slice(8,10))}일 일정`:"선택 날짜 일정";dayCount.textContent=`${list.length}건`;
 dayEvents.innerHTML=list.length?list.map(x=>`<div class="day-event"><time>${esc(x.type)}</time><div><strong>${esc(x.title)}</strong><small>${esc(x.sub)}</small></div></div>`).join(""):'<div class="empty">날짜를 선택하면 해당 일정이 표시됩니다.</div>';
}
prevMonth.onclick=()=>{cal.setMonth(cal.getMonth()-1);renderCalendar()};nextMonth.onclick=()=>{cal.setMonth(cal.getMonth()+1);renderCalendar()};todayMonth.onclick=()=>{cal=new Date();renderCalendar()};
function renderKorea(){
 const visited=new Set(trips.filter(x=>x.trip_type==="국내").map(x=>x.region));
 $$(".korea-visual button").forEach(b=>{b.classList.toggle("visited",visited.has(b.dataset.region));b.onclick=()=>{$$(".korea-visual button").forEach(x=>x.classList.remove("active"));b.classList.add("active");const r=b.dataset.region,related=trips.filter(x=>x.region===r);koreaRegion.textContent=r;koreaDesc.textContent=related.length?`${r}에 등록된 여행 ${related.length}건입니다.`:`${r}에 아직 등록된 여행이 없습니다.`;koreaTripList.innerHTML=related.map(x=>`<div class="mini-trip"><b>${esc(x.title)}</b><small>${x.start_date||""} · ${esc(x.city||"")}</small></div>`).join("")}})}
function renderWorld(){
 const fallback=[["대한민국",74,35],["일본",82,35],["베트남",76,53],["프랑스",47,31],["미국",18,32],["호주",81,78]];
 const rows=worldPlaces.length?worldPlaces:fallback.map((x,i)=>({country:x[0],x_percent:x[1],y_percent:x[2],status:i<3?"방문":"버킷리스트"}));
 worldMarkers.innerHTML=rows.map((x,i)=>`<button class="world-marker ${x.status==="방문"?"visited":"wishlist"}" data-index="${i}" style="left:${x.x_percent}%;top:${x.y_percent}%">${esc(x.country)}</button>`).join("");
 $$(".world-marker").forEach(b=>b.onclick=()=>{const x=rows[Number(b.dataset.index)],related=trips.filter(t=>t.country===x.country);worldCountry.textContent=x.country;worldDesc.textContent=x.status==="방문"?"방문 기록이 있는 국가입니다.":"가고 싶은 곳으로 등록된 국가입니다.";worldTripList.innerHTML=related.map(t=>`<div class="mini-trip"><b>${esc(t.title)}</b><small>${t.start_date||""} · ${esc(t.city||"")}</small></div>`).join("")||'<div class="mini-trip"><small>등록된 여행이 없습니다.</small></div>'});
}
function renderBoard(){
 const q=boardSearch.value.toLowerCase(),type=boardType.value,status=boardStatus.value;
 const list=trips.filter(x=>(!type||x.trip_type===type)&&(!status||x.status===status)&&(`${x.title} ${x.city||""} ${x.country||""} ${x.region||""}`.toLowerCase().includes(q)));
 tripBoard.innerHTML=list.length?list.map(x=>`<div class="board-row"><span>${esc(x.trip_type)}</span><span>${esc(x.region||x.country||"-")}</span><b>${esc(x.title)}</b><time>${x.start_date||""}${x.end_date?` ~ ${x.end_date}`:""}</time><span class="status-chip ${x.status==="버킷리스트"?"bucket":x.status==="완료"?"done":""}">${esc(x.status||"예정")}</span></div>`).join(""):'<div class="empty-mini">조건에 맞는 여행이 없습니다.</div>';
}
boardSearch.oninput=renderBoard;boardType.onchange=renderBoard;boardStatus.onchange=renderBoard;
function renderBudgetOptions(){
 const options=trips.map(x=>`<option value="${x.id}">${esc(x.title)}</option>`).join("");budgetTripSelect.innerHTML=`<option value="">전체 여행</option>${options}`;if(selectedBudgetTrip)budgetTripSelect.value=selectedBudgetTrip;
}
function renderBudget(){
 const id=budgetTripSelect.value;selectedBudgetTrip=id;const list=budgets.filter(x=>!id||String(x.trip_id)===String(id)),total=list.reduce((s,x)=>s+Number(x.budget_amount||0),0),spent=list.reduce((s,x)=>s+Number(x.spent_amount||0),0),remain=total-spent,rate=total?Math.round(spent/total*100):0;
 budgetTotal.textContent=money(total);budgetSpent.textContent=money(spent);budgetRemain.textContent=money(remain);budgetRate.textContent=rate+"%";
 budgetTable.innerHTML=`<div class="budget-row head"><span>항목</span><span>예산</span><span>지출</span><span>잔액</span></div>`+(list.length?list.map(x=>`<div class="budget-row"><b>${esc(x.category)}</b><span>${money(x.budget_amount)}</span><span>${money(x.spent_amount)}</span><span>${money(Number(x.budget_amount)-Number(x.spent_amount))}</span></div>`).join(""):'<div class="empty-mini">등록된 예산이 없습니다.</div>');
}
budgetTripSelect.onchange=renderBudget;
$$(".nav a,.quick-grid a").forEach(a=>a.onclick=e=>{const id=(a.dataset.target||a.getAttribute("href")?.replace("#",""));if(id&&document.getElementById(id)){e.preventDefault();document.getElementById(id).scrollIntoView({behavior:"smooth"})}});
globalSearchBtn.onclick=()=>{const q=globalSearch.value.trim().toLowerCase();if(!q)return;boardSearch.value=q;renderBoard();document.getElementById("board").scrollIntoView({behavior:"smooth"})};
const ids=["home","calendar","korea","world","board","budget"];addEventListener("scroll",()=>{let cur="home";ids.forEach(id=>{const el=document.getElementById(id);if(el&&el.getBoundingClientRect().top<140)cur=id});$$(".nav a").forEach(a=>a.classList.toggle("active",a.dataset.target===cur))},{passive:true});
loadAll();