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

function cleanAutoRegisteredMemo(value){
 const text=String(value||"");
 return text.replace(/^지역별 일정 자동등록(?:\s*·\s*[^\n]*)?\n?/,"").trim();
}

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


// ===== v6.0.20 GLOBAL COUNTRY / SEARCHABLE LOCATION DIRECTORY =====
const WORLD_COUNTRY_DIRECTORY=[{"name":"가나","en":"Ghana","code":"GH","aliases":["Republic of Ghana"]},{"name":"가봉","en":"Gabon","code":"GA","aliases":["Gabonese Republic"]},{"name":"가이아나","en":"Guyana","code":"GY","aliases":["Republic of Guyana"]},{"name":"감비아","en":"Gambia","code":"GM","aliases":["Republic of the Gambia"]},{"name":"건지","en":"Guernsey","code":"GG","aliases":[]},{"name":"과들루프","en":"Guadeloupe","code":"GP","aliases":[]},{"name":"과테말라","en":"Guatemala","code":"GT","aliases":["Republic of Guatemala"]},{"name":"괌","en":"Guam","code":"GU","aliases":["Guam"]},{"name":"그레나다","en":"Grenada","code":"GD","aliases":[]},{"name":"그리스","en":"Greece","code":"GR","aliases":["Hellenic Republic"]},{"name":"그린란드","en":"Greenland","code":"GL","aliases":[]},{"name":"기니","en":"Guinea","code":"GN","aliases":["Republic of Guinea"]},{"name":"기니비사우","en":"Guinea-Bissau","code":"GW","aliases":["Republic of Guinea-Bissau"]},{"name":"나미비아","en":"Namibia","code":"NA","aliases":["Republic of Namibia"]},{"name":"나우루","en":"Nauru","code":"NR","aliases":["Republic of Nauru"]},{"name":"나이지리아","en":"Nigeria","code":"NG","aliases":["Federal Republic of Nigeria"]},{"name":"남극 대륙","en":"Antarctica","code":"AQ","aliases":[]},{"name":"남수단","en":"South Sudan","code":"SS","aliases":["Republic of South Sudan"]},{"name":"남아프리카공화국","en":"South Africa","code":"ZA","aliases":["Republic of South Africa"]},{"name":"네덜란드","en":"Netherlands","code":"NL","aliases":["Kingdom of the Netherlands"]},{"name":"네덜란드령 카리브","en":"Bonaire, Sint Eustatius and Saba","code":"BQ","aliases":["Bonaire, Sint Eustatius and Saba"]},{"name":"네팔","en":"Nepal","code":"NP","aliases":["Federal Democratic Republic of Nepal"]},{"name":"노르웨이","en":"Norway","code":"NO","aliases":["Kingdom of Norway"]},{"name":"노퍽섬","en":"Norfolk Island","code":"NF","aliases":[]},{"name":"뉴질랜드","en":"New Zealand","code":"NZ","aliases":[]},{"name":"뉴칼레도니아","en":"New Caledonia","code":"NC","aliases":[]},{"name":"니우에","en":"Niue","code":"NU","aliases":["Niue"]},{"name":"니제르","en":"Niger","code":"NE","aliases":["Republic of the Niger"]},{"name":"니카라과","en":"Nicaragua","code":"NI","aliases":["Republic of Nicaragua"]},{"name":"대만","en":"Taiwan, Province of China","code":"TW","aliases":["Taiwan, Province of China","Taiwan","타이완"]},{"name":"대한민국","en":"Korea, Republic of","code":"KR","aliases":["South Korea","한국","Korea","Republic of Korea"]},{"name":"덴마크","en":"Denmark","code":"DK","aliases":["Kingdom of Denmark"]},{"name":"도미니카","en":"Dominica","code":"DM","aliases":["Commonwealth of Dominica"]},{"name":"도미니카 공화국","en":"Dominican Republic","code":"DO","aliases":[]},{"name":"독일","en":"Germany","code":"DE","aliases":["Federal Republic of Germany"]},{"name":"동티모르","en":"Timor-Leste","code":"TL","aliases":["Democratic Republic of Timor-Leste"]},{"name":"라오스","en":"Lao People's Democratic Republic","code":"LA","aliases":["Laos"]},{"name":"라이베리아","en":"Liberia","code":"LR","aliases":["Republic of Liberia"]},{"name":"라트비아","en":"Latvia","code":"LV","aliases":["Republic of Latvia"]},{"name":"러시아","en":"Russian Federation","code":"RU","aliases":["Russia"]},{"name":"레바논","en":"Lebanon","code":"LB","aliases":["Lebanese Republic"]},{"name":"레소토","en":"Lesotho","code":"LS","aliases":["Kingdom of Lesotho"]},{"name":"레위니옹","en":"Réunion","code":"RE","aliases":[]},{"name":"루마니아","en":"Romania","code":"RO","aliases":[]},{"name":"룩셈부르크","en":"Luxembourg","code":"LU","aliases":["Grand Duchy of Luxembourg"]},{"name":"르완다","en":"Rwanda","code":"RW","aliases":["Rwandese Republic"]},{"name":"리비아","en":"Libya","code":"LY","aliases":["Libya"]},{"name":"리투아니아","en":"Lithuania","code":"LT","aliases":["Republic of Lithuania"]},{"name":"리히텐슈타인","en":"Liechtenstein","code":"LI","aliases":["Principality of Liechtenstein"]},{"name":"마다가스카르","en":"Madagascar","code":"MG","aliases":["Republic of Madagascar"]},{"name":"마르티니크","en":"Martinique","code":"MQ","aliases":[]},{"name":"마셜 제도","en":"Marshall Islands","code":"MH","aliases":["Republic of the Marshall Islands"]},{"name":"마요트","en":"Mayotte","code":"YT","aliases":[]},{"name":"마카오","en":"Macao","code":"MO","aliases":["Macao Special Administrative Region of China","Macao","Macau"]},{"name":"말라위","en":"Malawi","code":"MW","aliases":["Republic of Malawi"]},{"name":"말레이시아","en":"Malaysia","code":"MY","aliases":[]},{"name":"말리","en":"Mali","code":"ML","aliases":["Republic of Mali"]},{"name":"맨섬","en":"Isle of Man","code":"IM","aliases":[]},{"name":"멕시코","en":"Mexico","code":"MX","aliases":["United Mexican States"]},{"name":"모나코","en":"Monaco","code":"MC","aliases":["Principality of Monaco"]},{"name":"모로코","en":"Morocco","code":"MA","aliases":["Kingdom of Morocco"]},{"name":"모리셔스","en":"Mauritius","code":"MU","aliases":["Republic of Mauritius"]},{"name":"모리타니","en":"Mauritania","code":"MR","aliases":["Islamic Republic of Mauritania"]},{"name":"모잠비크","en":"Mozambique","code":"MZ","aliases":["Republic of Mozambique"]},{"name":"몬테네그로","en":"Montenegro","code":"ME","aliases":["Montenegro"]},{"name":"몬트세라트","en":"Montserrat","code":"MS","aliases":[]},{"name":"몰도바","en":"Moldova, Republic of","code":"MD","aliases":["Republic of Moldova","Moldova"]},{"name":"몰디브","en":"Maldives","code":"MV","aliases":["Republic of Maldives"]},{"name":"몰타","en":"Malta","code":"MT","aliases":["Republic of Malta"]},{"name":"몽골","en":"Mongolia","code":"MN","aliases":[]},{"name":"미국","en":"United States","code":"US","aliases":["United States of America","USA","US","U.S.A.","미합중국"]},{"name":"미국령 버진아일랜드","en":"Virgin Islands, U.S.","code":"VI","aliases":["Virgin Islands of the United States"]},{"name":"미국령 해외 제도","en":"United States Minor Outlying Islands","code":"UM","aliases":[]},{"name":"미얀마","en":"Myanmar","code":"MM","aliases":["Republic of Myanmar"]},{"name":"미크로네시아","en":"Micronesia, Federated States of","code":"FM","aliases":["Federated States of Micronesia"]},{"name":"바누아투","en":"Vanuatu","code":"VU","aliases":["Republic of Vanuatu"]},{"name":"바레인","en":"Bahrain","code":"BH","aliases":["Kingdom of Bahrain"]},{"name":"바베이도스","en":"Barbados","code":"BB","aliases":[]},{"name":"바티칸 시국","en":"Holy See (Vatican City State)","code":"VA","aliases":[]},{"name":"바하마","en":"Bahamas","code":"BS","aliases":["Commonwealth of the Bahamas"]},{"name":"방글라데시","en":"Bangladesh","code":"BD","aliases":["People's Republic of Bangladesh"]},{"name":"버뮤다","en":"Bermuda","code":"BM","aliases":[]},{"name":"베냉","en":"Benin","code":"BJ","aliases":["Republic of Benin"]},{"name":"베네수엘라","en":"Venezuela, Bolivarian Republic of","code":"VE","aliases":["Bolivarian Republic of Venezuela","Venezuela"]},{"name":"베트남","en":"Viet Nam","code":"VN","aliases":["Socialist Republic of Viet Nam","Vietnam"]},{"name":"벨기에","en":"Belgium","code":"BE","aliases":["Kingdom of Belgium"]},{"name":"벨라루스","en":"Belarus","code":"BY","aliases":["Republic of Belarus"]},{"name":"벨리즈","en":"Belize","code":"BZ","aliases":[]},{"name":"보스니아 헤르체고비나","en":"Bosnia and Herzegovina","code":"BA","aliases":["Republic of Bosnia and Herzegovina"]},{"name":"보츠와나","en":"Botswana","code":"BW","aliases":["Republic of Botswana"]},{"name":"볼리비아","en":"Bolivia, Plurinational State of","code":"BO","aliases":["Plurinational State of Bolivia","Bolivia"]},{"name":"부룬디","en":"Burundi","code":"BI","aliases":["Republic of Burundi"]},{"name":"부르키나파소","en":"Burkina Faso","code":"BF","aliases":[]},{"name":"부베섬","en":"Bouvet Island","code":"BV","aliases":[]},{"name":"부탄","en":"Bhutan","code":"BT","aliases":["Kingdom of Bhutan"]},{"name":"북마리아나 제도","en":"Northern Mariana Islands","code":"MP","aliases":["Commonwealth of the Northern Mariana Islands","사이판","Saipan","Northern Mariana Islands"]},{"name":"북마케도니아","en":"North Macedonia","code":"MK","aliases":["Republic of North Macedonia"]},{"name":"북한","en":"Korea, Democratic People's Republic of","code":"KP","aliases":["Democratic People's Republic of Korea","North Korea","DPRK"]},{"name":"불가리아","en":"Bulgaria","code":"BG","aliases":["Republic of Bulgaria"]},{"name":"브라질","en":"Brazil","code":"BR","aliases":["Federative Republic of Brazil"]},{"name":"브루나이","en":"Brunei Darussalam","code":"BN","aliases":["Brunei"]},{"name":"사모아","en":"Samoa","code":"WS","aliases":["Independent State of Samoa"]},{"name":"사우디아라비아","en":"Saudi Arabia","code":"SA","aliases":["Kingdom of Saudi Arabia"]},{"name":"사우스조지아 사우스샌드위치 제도","en":"South Georgia and the South Sandwich Islands","code":"GS","aliases":[]},{"name":"산마리노","en":"San Marino","code":"SM","aliases":["Republic of San Marino"]},{"name":"상투메 프린시페","en":"Sao Tome and Principe","code":"ST","aliases":["Democratic Republic of Sao Tome and Principe"]},{"name":"생마르탱","en":"Saint Martin (French part)","code":"MF","aliases":[]},{"name":"생바르텔레미","en":"Saint Barthélemy","code":"BL","aliases":[]},{"name":"생피에르 미클롱","en":"Saint Pierre and Miquelon","code":"PM","aliases":[]},{"name":"서사하라","en":"Western Sahara","code":"EH","aliases":[]},{"name":"세네갈","en":"Senegal","code":"SN","aliases":["Republic of Senegal"]},{"name":"세르비아","en":"Serbia","code":"RS","aliases":["Republic of Serbia"]},{"name":"세이셸","en":"Seychelles","code":"SC","aliases":["Republic of Seychelles"]},{"name":"세인트루시아","en":"Saint Lucia","code":"LC","aliases":[]},{"name":"세인트빈센트그레나딘","en":"Saint Vincent and the Grenadines","code":"VC","aliases":[]},{"name":"세인트키츠 네비스","en":"Saint Kitts and Nevis","code":"KN","aliases":[]},{"name":"세인트헬레나","en":"Saint Helena, Ascension and Tristan da Cunha","code":"SH","aliases":[]},{"name":"소말리아","en":"Somalia","code":"SO","aliases":["Federal Republic of Somalia"]},{"name":"솔로몬 제도","en":"Solomon Islands","code":"SB","aliases":[]},{"name":"수단","en":"Sudan","code":"SD","aliases":["Republic of the Sudan"]},{"name":"수리남","en":"Suriname","code":"SR","aliases":["Republic of Suriname"]},{"name":"스리랑카","en":"Sri Lanka","code":"LK","aliases":["Democratic Socialist Republic of Sri Lanka"]},{"name":"스발바르제도-얀마웬섬","en":"Svalbard and Jan Mayen","code":"SJ","aliases":[]},{"name":"스웨덴","en":"Sweden","code":"SE","aliases":["Kingdom of Sweden"]},{"name":"스위스","en":"Switzerland","code":"CH","aliases":["Swiss Confederation"]},{"name":"스페인","en":"Spain","code":"ES","aliases":["Kingdom of Spain"]},{"name":"슬로바키아","en":"Slovakia","code":"SK","aliases":["Slovak Republic"]},{"name":"슬로베니아","en":"Slovenia","code":"SI","aliases":["Republic of Slovenia"]},{"name":"시리아","en":"Syrian Arab Republic","code":"SY","aliases":["Syria"]},{"name":"시에라리온","en":"Sierra Leone","code":"SL","aliases":["Republic of Sierra Leone"]},{"name":"신트마르턴","en":"Sint Maarten (Dutch part)","code":"SX","aliases":["Sint Maarten (Dutch part)"]},{"name":"싱가포르","en":"Singapore","code":"SG","aliases":["Republic of Singapore"]},{"name":"아랍에미리트","en":"United Arab Emirates","code":"AE","aliases":["UAE"]},{"name":"아루바","en":"Aruba","code":"AW","aliases":[]},{"name":"아르메니아","en":"Armenia","code":"AM","aliases":["Republic of Armenia"]},{"name":"아르헨티나","en":"Argentina","code":"AR","aliases":["Argentine Republic"]},{"name":"아메리칸 사모아","en":"American Samoa","code":"AS","aliases":[]},{"name":"아이슬란드","en":"Iceland","code":"IS","aliases":["Republic of Iceland"]},{"name":"아이티","en":"Haiti","code":"HT","aliases":["Republic of Haiti"]},{"name":"아일랜드","en":"Ireland","code":"IE","aliases":[]},{"name":"아제르바이잔","en":"Azerbaijan","code":"AZ","aliases":["Republic of Azerbaijan"]},{"name":"아프가니스탄","en":"Afghanistan","code":"AF","aliases":["Islamic Republic of Afghanistan"]},{"name":"안도라","en":"Andorra","code":"AD","aliases":["Principality of Andorra"]},{"name":"알바니아","en":"Albania","code":"AL","aliases":["Republic of Albania"]},{"name":"알제리","en":"Algeria","code":"DZ","aliases":["People's Democratic Republic of Algeria"]},{"name":"앙골라","en":"Angola","code":"AO","aliases":["Republic of Angola"]},{"name":"앤티가 바부다","en":"Antigua and Barbuda","code":"AG","aliases":[]},{"name":"앵귈라","en":"Anguilla","code":"AI","aliases":[]},{"name":"에리트리아","en":"Eritrea","code":"ER","aliases":["the State of Eritrea"]},{"name":"에스와티니","en":"Eswatini","code":"SZ","aliases":["Kingdom of Eswatini"]},{"name":"에스토니아","en":"Estonia","code":"EE","aliases":["Republic of Estonia"]},{"name":"에콰도르","en":"Ecuador","code":"EC","aliases":["Republic of Ecuador"]},{"name":"에티오피아","en":"Ethiopia","code":"ET","aliases":["Federal Democratic Republic of Ethiopia"]},{"name":"엘살바도르","en":"El Salvador","code":"SV","aliases":["Republic of El Salvador"]},{"name":"영국","en":"United Kingdom","code":"GB","aliases":["United Kingdom of Great Britain and Northern Ireland","UK","U.K.","Great Britain","Britain"]},{"name":"영국령 버진아일랜드","en":"Virgin Islands, British","code":"VG","aliases":["British Virgin Islands"]},{"name":"영국령 인도양 지역","en":"British Indian Ocean Territory","code":"IO","aliases":[]},{"name":"예멘","en":"Yemen","code":"YE","aliases":["Republic of Yemen"]},{"name":"오만","en":"Oman","code":"OM","aliases":["Sultanate of Oman"]},{"name":"오스트레일리아","en":"Australia","code":"AU","aliases":[]},{"name":"오스트리아","en":"Austria","code":"AT","aliases":["Republic of Austria"]},{"name":"온두라스","en":"Honduras","code":"HN","aliases":["Republic of Honduras"]},{"name":"올란드 제도","en":"Åland Islands","code":"AX","aliases":[]},{"name":"왈리스-푸투나 제도","en":"Wallis and Futuna","code":"WF","aliases":[]},{"name":"요르단","en":"Jordan","code":"JO","aliases":["Hashemite Kingdom of Jordan"]},{"name":"우간다","en":"Uganda","code":"UG","aliases":["Republic of Uganda"]},{"name":"우루과이","en":"Uruguay","code":"UY","aliases":["Eastern Republic of Uruguay"]},{"name":"우즈베키스탄","en":"Uzbekistan","code":"UZ","aliases":["Republic of Uzbekistan"]},{"name":"우크라이나","en":"Ukraine","code":"UA","aliases":[]},{"name":"이라크","en":"Iraq","code":"IQ","aliases":["Republic of Iraq"]},{"name":"이란","en":"Iran, Islamic Republic of","code":"IR","aliases":["Islamic Republic of Iran","Iran"]},{"name":"이스라엘","en":"Israel","code":"IL","aliases":["State of Israel"]},{"name":"이집트","en":"Egypt","code":"EG","aliases":["Arab Republic of Egypt"]},{"name":"이탈리아","en":"Italy","code":"IT","aliases":["Italian Republic"]},{"name":"인도","en":"India","code":"IN","aliases":["Republic of India"]},{"name":"인도네시아","en":"Indonesia","code":"ID","aliases":["Republic of Indonesia"]},{"name":"일본","en":"Japan","code":"JP","aliases":["Japan","JP"]},{"name":"자메이카","en":"Jamaica","code":"JM","aliases":[]},{"name":"잠비아","en":"Zambia","code":"ZM","aliases":["Republic of Zambia"]},{"name":"저지","en":"Jersey","code":"JE","aliases":[]},{"name":"적도 기니","en":"Equatorial Guinea","code":"GQ","aliases":["Republic of Equatorial Guinea"]},{"name":"조지아","en":"Georgia","code":"GE","aliases":[]},{"name":"중국","en":"China","code":"CN","aliases":["People's Republic of China","China","PRC","중화인민공화국"]},{"name":"중앙 아프리카 공화국","en":"Central African Republic","code":"CF","aliases":[]},{"name":"지부티","en":"Djibouti","code":"DJ","aliases":["Republic of Djibouti"]},{"name":"지브롤터","en":"Gibraltar","code":"GI","aliases":[]},{"name":"짐바브웨","en":"Zimbabwe","code":"ZW","aliases":["Republic of Zimbabwe"]},{"name":"차드","en":"Chad","code":"TD","aliases":["Republic of Chad"]},{"name":"체코","en":"Czechia","code":"CZ","aliases":["Czech Republic","Czechia"]},{"name":"칠레","en":"Chile","code":"CL","aliases":["Republic of Chile"]},{"name":"카메룬","en":"Cameroon","code":"CM","aliases":["Republic of Cameroon"]},{"name":"카보베르데","en":"Cabo Verde","code":"CV","aliases":["Republic of Cabo Verde"]},{"name":"카자흐스탄","en":"Kazakhstan","code":"KZ","aliases":["Republic of Kazakhstan"]},{"name":"카타르","en":"Qatar","code":"QA","aliases":["State of Qatar"]},{"name":"캄보디아","en":"Cambodia","code":"KH","aliases":["Kingdom of Cambodia"]},{"name":"캐나다","en":"Canada","code":"CA","aliases":[]},{"name":"케냐","en":"Kenya","code":"KE","aliases":["Republic of Kenya"]},{"name":"케이맨 제도","en":"Cayman Islands","code":"KY","aliases":[]},{"name":"코모로","en":"Comoros","code":"KM","aliases":["Union of the Comoros"]},{"name":"코소보","en":"Kosovo","code":"XK","aliases":["Republic of Kosovo","Kosovo"]},{"name":"코스타리카","en":"Costa Rica","code":"CR","aliases":["Republic of Costa Rica"]},{"name":"코코스 제도","en":"Cocos (Keeling) Islands","code":"CC","aliases":[]},{"name":"코트디부아르","en":"Côte d'Ivoire","code":"CI","aliases":["Republic of Côte d'Ivoire"]},{"name":"콜롬비아","en":"Colombia","code":"CO","aliases":["Republic of Colombia"]},{"name":"콩고-브라자빌","en":"Congo","code":"CG","aliases":["Republic of the Congo"]},{"name":"콩고-킨샤사","en":"Congo, The Democratic Republic of the","code":"CD","aliases":[]},{"name":"쿠바","en":"Cuba","code":"CU","aliases":["Republic of Cuba"]},{"name":"쿠웨이트","en":"Kuwait","code":"KW","aliases":["State of Kuwait"]},{"name":"쿡 제도","en":"Cook Islands","code":"CK","aliases":[]},{"name":"퀴라소","en":"Curaçao","code":"CW","aliases":["Curaçao"]},{"name":"크로아티아","en":"Croatia","code":"HR","aliases":["Republic of Croatia"]},{"name":"크리스마스섬","en":"Christmas Island","code":"CX","aliases":[]},{"name":"키르기스스탄","en":"Kyrgyzstan","code":"KG","aliases":["Kyrgyz Republic"]},{"name":"키리바시","en":"Kiribati","code":"KI","aliases":["Republic of Kiribati"]},{"name":"키프로스","en":"Cyprus","code":"CY","aliases":["Republic of Cyprus"]},{"name":"타지키스탄","en":"Tajikistan","code":"TJ","aliases":["Republic of Tajikistan"]},{"name":"탄자니아","en":"Tanzania, United Republic of","code":"TZ","aliases":["United Republic of Tanzania","Tanzania"]},{"name":"태국","en":"Thailand","code":"TH","aliases":["Kingdom of Thailand"]},{"name":"터크스 케이커스 제도","en":"Turks and Caicos Islands","code":"TC","aliases":[]},{"name":"토고","en":"Togo","code":"TG","aliases":["Togolese Republic"]},{"name":"토켈라우","en":"Tokelau","code":"TK","aliases":[]},{"name":"통가","en":"Tonga","code":"TO","aliases":["Kingdom of Tonga"]},{"name":"투르크메니스탄","en":"Turkmenistan","code":"TM","aliases":[]},{"name":"투발루","en":"Tuvalu","code":"TV","aliases":[]},{"name":"튀니지","en":"Tunisia","code":"TN","aliases":["Republic of Tunisia"]},{"name":"튀르키예","en":"Türkiye","code":"TR","aliases":["Republic of Türkiye","Turkey","Turkiye"]},{"name":"트리니다드 토바고","en":"Trinidad and Tobago","code":"TT","aliases":["Republic of Trinidad and Tobago"]},{"name":"파나마","en":"Panama","code":"PA","aliases":["Republic of Panama"]},{"name":"파라과이","en":"Paraguay","code":"PY","aliases":["Republic of Paraguay"]},{"name":"파키스탄","en":"Pakistan","code":"PK","aliases":["Islamic Republic of Pakistan"]},{"name":"파푸아뉴기니","en":"Papua New Guinea","code":"PG","aliases":["Independent State of Papua New Guinea"]},{"name":"팔라우","en":"Palau","code":"PW","aliases":["Republic of Palau"]},{"name":"팔레스타인","en":"Palestine, State of","code":"PS","aliases":["the State of Palestine","Palestine"]},{"name":"페로 제도","en":"Faroe Islands","code":"FO","aliases":[]},{"name":"페루","en":"Peru","code":"PE","aliases":["Republic of Peru"]},{"name":"포르투갈","en":"Portugal","code":"PT","aliases":["Portuguese Republic"]},{"name":"포클랜드 제도","en":"Falkland Islands (Malvinas)","code":"FK","aliases":[]},{"name":"폴란드","en":"Poland","code":"PL","aliases":["Republic of Poland"]},{"name":"푸에르토리코","en":"Puerto Rico","code":"PR","aliases":[]},{"name":"프랑스","en":"France","code":"FR","aliases":["French Republic"]},{"name":"프랑스령 기아나","en":"French Guiana","code":"GF","aliases":[]},{"name":"프랑스령 남방 지역","en":"French Southern Territories","code":"TF","aliases":[]},{"name":"프랑스령 폴리네시아","en":"French Polynesia","code":"PF","aliases":[]},{"name":"피지","en":"Fiji","code":"FJ","aliases":["Republic of Fiji"]},{"name":"핀란드","en":"Finland","code":"FI","aliases":["Republic of Finland"]},{"name":"필리핀","en":"Philippines","code":"PH","aliases":["Republic of the Philippines"]},{"name":"핏케언 제도","en":"Pitcairn","code":"PN","aliases":[]},{"name":"허드 맥도널드 제도","en":"Heard Island and McDonald Islands","code":"HM","aliases":[]},{"name":"헝가리","en":"Hungary","code":"HU","aliases":["Hungary"]},{"name":"홍콩","en":"Hong Kong","code":"HK","aliases":["Hong Kong Special Administrative Region of China","Hong Kong"]}];
const WORLD_COUNTRY_NAMES=WORLD_COUNTRY_DIRECTORY.map(x=>x.name);
const WORLD_COUNTRY_BY_NAME=Object.fromEntries(WORLD_COUNTRY_DIRECTORY.map(x=>[x.name,x]));
const WORLD_COUNTRY_CENTERS={"아루바":[12.5,-69.966667],"아프가니스탄":[33.0,65.0],"앙골라":[-12.5,18.5],"앵귈라":[18.25,-63.166667],"알바니아":[41.0,20.0],"아랍에미리트":[24.0,54.0],"아르헨티나":[-34.0,-64.0],"아르메니아":[40.0,45.0],"아메리칸 사모아":[-14.333333,-170.0],"앤티가 바부다":[17.05,-61.8],"오스트레일리아":[-27.0,133.0],"오스트리아":[47.333333,13.333333],"아제르바이잔":[40.5,47.5],"부룬디":[-3.5,30.0],"벨기에":[50.833333,4.0],"베냉":[9.5,2.25],"부르키나파소":[13.0,-2.0],"방글라데시":[24.0,90.0],"불가리아":[43.0,25.0],"바레인":[26.0,50.55],"바하마":[24.25,-76.0],"보스니아 헤르체고비나":[44.0,18.0],"벨라루스":[53.0,28.0],"벨리즈":[17.25,-88.75],"버뮤다":[32.333333,-64.75],"볼리비아":[-17.0,-65.0],"브라질":[-10.0,-55.0],"바베이도스":[13.166667,-59.533333],"부탄":[27.5,90.5],"보츠와나":[-22.0,24.0],"중앙 아프리카 공화국":[7.0,21.0],"캐나다":[60.0,-95.0],"코코스 제도":[-12.5,96.833333],"스위스":[47.0,8.0],"칠레":[-30.0,-71.0],"중국":[35.0,105.0],"코트디부아르":[8.0,-5.0],"카메룬":[6.0,12.0],"콩고-브라자빌":[-1.0,15.0],"쿡 제도":[-21.233333,-159.766667],"콜롬비아":[4.0,-72.0],"코모로":[-12.166667,44.25],"카보베르데":[16.0,-24.0],"코스타리카":[10.0,-84.0],"쿠바":[21.5,-80.0],"크리스마스섬":[-10.5,105.666667],"케이맨 제도":[19.5,-80.5],"키프로스":[35.0,33.0],"체코":[49.75,15.5],"독일":[51.0,9.0],"지부티":[11.5,43.0],"도미니카":[15.416667,-61.333333],"덴마크":[56.0,10.0],"도미니카 공화국":[19.0,-70.666667],"알제리":[28.0,3.0],"에콰도르":[-2.0,-77.5],"이집트":[27.0,30.0],"에리트리아":[15.0,39.0],"서사하라":[24.5,-13.0],"스페인":[40.0,-4.0],"에스토니아":[59.0,26.0],"에티오피아":[8.0,38.0],"핀란드":[64.0,26.0],"피지":[-18.0,175.0],"프랑스":[46.0,2.0],"페로 제도":[62.0,-7.0],"미크로네시아":[6.916667,158.25],"가봉":[-1.0,11.75],"영국":[54.0,-2.0],"조지아":[42.0,43.5],"건지":[49.466667,-2.583333],"가나":[8.0,-2.0],"지브롤터":[36.133333,-5.35],"기니":[11.0,-10.0],"과들루프":[16.25,-61.583333],"감비아":[13.466667,-16.566667],"기니비사우":[12.0,-15.0],"적도 기니":[2.0,10.0],"그리스":[39.0,22.0],"그레나다":[12.116667,-61.666667],"그린란드":[72.0,-40.0],"과테말라":[15.5,-90.25],"프랑스령 기아나":[4.0,-53.0],"괌":[13.466667,144.783333],"가이아나":[5.0,-59.0],"홍콩":[22.25,114.166667],"허드 맥도널드 제도":[-53.1,72.516667],"온두라스":[15.0,-86.5],"크로아티아":[45.166667,15.5],"아이티":[19.0,-72.416667],"헝가리":[47.0,20.0],"인도네시아":[-5.0,120.0],"맨섬":[54.25,-4.5],"인도":[20.0,77.0],"영국령 인도양 지역":[-6.0,71.5],"아일랜드":[53.0,-8.0],"이란":[32.0,53.0],"이라크":[33.0,44.0],"아이슬란드":[65.0,-18.0],"이스라엘":[31.5,34.75],"이탈리아":[42.833333,12.833333],"자메이카":[18.25,-77.5],"저지":[49.25,-2.166667],"요르단":[31.0,36.0],"일본":[36.0,138.0],"카자흐스탄":[48.0,68.0],"케냐":[1.0,38.0],"키르기스스탄":[41.0,75.0],"캄보디아":[13.0,105.0],"키리바시":[1.416667,173.0],"세인트키츠 네비스":[17.333333,-62.75],"대한민국":[37.0,127.5],"쿠웨이트":[29.5,45.75],"라오스":[18.0,105.0],"레바논":[33.833333,35.833333],"라이베리아":[6.5,-9.5],"리비아":[25.0,17.0],"세인트루시아":[13.883333,-60.966667],"리히텐슈타인":[47.266667,9.533333],"스리랑카":[7.0,81.0],"레소토":[-29.5,28.5],"리투아니아":[56.0,24.0],"룩셈부르크":[49.75,6.166667],"라트비아":[57.0,25.0],"모로코":[32.0,-5.0],"모나코":[43.733333,7.4],"몰도바":[47.0,29.0],"마다가스카르":[-20.0,47.0],"몰디브":[3.25,73.0],"멕시코":[23.0,-102.0],"마셜 제도":[9.0,168.0],"말리":[17.0,-4.0],"몰타":[35.833333,14.583333],"몽골":[46.0,105.0],"북마리아나 제도":[15.2,145.75],"모잠비크":[-18.25,35.0],"모리타니":[20.0,-12.0],"몬트세라트":[16.75,-62.2],"마르티니크":[14.666667,-61.0],"모리셔스":[-20.283333,57.55],"말라위":[-13.5,34.0],"말레이시아":[2.5,112.5],"마요트":[-12.833333,45.166667],"나미비아":[-22.0,17.0],"뉴칼레도니아":[-21.5,165.5],"니제르":[16.0,8.0],"노퍽섬":[-29.033333,167.95],"나이지리아":[10.0,8.0],"니카라과":[13.0,-85.0],"니우에":[-19.033333,-169.866667],"네덜란드":[52.5,5.75],"노르웨이":[62.0,10.0],"네팔":[28.0,84.0],"나우루":[-0.533333,166.916667],"뉴질랜드":[-41.0,174.0],"오만":[21.0,57.0],"파키스탄":[30.0,70.0],"파나마":[9.0,-80.0],"페루":[-10.0,-76.0],"필리핀":[13.0,122.0],"팔라우":[7.5,134.5],"파푸아뉴기니":[-6.0,147.0],"폴란드":[52.0,20.0],"푸에르토리코":[18.25,-66.5],"북한":[40.0,127.0],"포르투갈":[39.5,-8.0],"파라과이":[-23.0,-58.0],"프랑스령 폴리네시아":[-15.0,-140.0],"카타르":[25.5,51.25],"레위니옹":[-21.15,55.5],"루마니아":[46.0,25.0],"러시아":[60.0,100.0],"르완다":[-2.0,30.0],"사우디아라비아":[25.0,45.0],"수단":[15.0,30.0],"세네갈":[14.0,-14.0],"싱가포르":[1.366667,103.8],"사우스조지아 사우스샌드위치 제도":[-54.5,-37.0],"스발바르제도-얀마웬섬":[78.0,20.0],"솔로몬 제도":[-8.0,159.0],"시에라리온":[8.5,-11.5],"엘살바도르":[13.833333,-88.916667],"산마리노":[43.766667,12.416667],"소말리아":[10.0,49.0],"생피에르 미클롱":[46.833333,-56.333333],"세르비아":[44.130502,16.428418],"남수단":[7.0,30.0],"수리남":[4.0,-56.0],"슬로바키아":[48.666667,19.5],"슬로베니아":[46.116667,14.816667],"스웨덴":[62.0,15.0],"세이셸":[-4.583333,55.666667],"시리아":[35.0,38.0],"차드":[15.0,19.0],"토고":[8.0,1.166667],"태국":[15.0,100.0],"타지키스탄":[39.0,71.0],"토켈라우":[-9.0,-172.0],"투르크메니스탄":[40.0,60.0],"동티모르":[-8.833333,125.916667],"통가":[-20.0,-175.0],"트리니다드 토바고":[11.0,-61.0],"튀니지":[34.0,9.0],"투발루":[-8.0,178.0],"대만":[23.5,121.0],"탄자니아":[-6.0,35.0],"우간다":[1.0,32.0],"우크라이나":[49.0,32.0],"우루과이":[-33.0,-56.0],"미국":[38.0,-97.0],"우즈베키스탄":[41.0,64.0],"세인트빈센트그레나딘":[13.25,-61.2],"베네수엘라":[8.0,-66.0],"베트남":[16.166667,107.833333],"바누아투":[-16.0,167.0],"왈리스-푸투나 제도":[-13.3,-176.2],"사모아":[-13.583333,-172.333333],"예멘":[15.0,48.0],"남아프리카공화국":[-29.0,24.0],"잠비아":[-15.0,30.0],"짐바브웨":[-20.0,30.0],"코소보":[42.6026,20.903]};
const WORLD_COUNTRY_CAPITALS={"아루바":"Oranjestad","아프가니스탄":"Kabul","앙골라":"Luanda","앵귈라":"The Valley","알바니아":"Tirana","아랍에미리트":"Abu Dhabi","아르헨티나":"Buenos Aires","아르메니아":"Yerevan","아메리칸 사모아":"Pago Pago","앤티가 바부다":"Saint John's","오스트레일리아":"Canberra","오스트리아":"Vienna","아제르바이잔":"Baku","부룬디":"Bujumbura","벨기에":"Brussels","베냉":"Porto-Novo","부르키나파소":"Ouagadougou","방글라데시":"Dhaka","불가리아":"Sofia","바레인":"Manama","바하마":"Nassau","보스니아 헤르체고비나":"Sarajevo","벨라루스":"Minsk","벨리즈":"Belmopan","버뮤다":"Hamilton","볼리비아":"Sucre","브라질":"Brasília","바베이도스":"Bridgetown","부탄":"Thimphu","보츠와나":"Gaborone","중앙 아프리카 공화국":"Bangui","캐나다":"Ottawa","코코스 제도":"West Island","스위스":"Bern","칠레":"Santiago","중국":"Beijing","코트디부아르":"Yamoussoukro","카메룬":"Yaoundé","콩고-브라자빌":"Brazzaville","쿡 제도":"Avarua","콜롬비아":"Bogotá","코모로":"Moroni","카보베르데":"Praia","코스타리카":"San José","쿠바":"Havana","크리스마스섬":"Flying Fish Cove","케이맨 제도":"George Town","키프로스":"Nicosia","체코":"Prague","독일":"Berlin","지부티":"Djibouti","도미니카":"Roseau","덴마크":"Copenhagen","도미니카 공화국":"Santo Domingo","알제리":"Algiers","에콰도르":"Quito","이집트":"Cairo","에리트리아":"Asmara","서사하라":"El Aaiún","스페인":"Madrid","에스토니아":"Tallinn","에티오피아":"Addis Ababa","핀란드":"Helsinki","피지":"Suva","프랑스":"Paris","페로 제도":"Tórshavn","미크로네시아":"Palikir","가봉":"Libreville","영국":"London","조지아":"Tbilisi","건지":"St. Peter Port","가나":"Accra","지브롤터":"Gibraltar","기니":"Conakry","과들루프":"Basse-Terre","감비아":"Banjul","기니비사우":"Bissau","적도 기니":"Malabo","그리스":"Athens","그레나다":"St. George's","그린란드":"Nuuk","과테말라":"Guatemala City","프랑스령 기아나":"Cayenne","괌":"Hagåtña","가이아나":"Georgetown","홍콩":"City of Victoria","온두라스":"Tegucigalpa","크로아티아":"Zagreb","아이티":"Port-au-Prince","헝가리":"Budapest","인도네시아":"Jakarta","맨섬":"Douglas","인도":"New Delhi","영국령 인도양 지역":"Diego Garcia","아일랜드":"Dublin","이란":"Tehran","이라크":"Baghdad","아이슬란드":"Reykjavik","이스라엘":"Jerusalem","이탈리아":"Rome","자메이카":"Kingston","저지":"Saint Helier","요르단":"Amman","일본":"Tokyo","카자흐스탄":"Astana","케냐":"Nairobi","키르기스스탄":"Bishkek","캄보디아":"Phnom Penh","키리바시":"South Tarawa","세인트키츠 네비스":"Basseterre","대한민국":"Seoul","쿠웨이트":"Kuwait City","라오스":"Vientiane","레바논":"Beirut","라이베리아":"Monrovia","리비아":"Tripoli","세인트루시아":"Castries","리히텐슈타인":"Vaduz","스리랑카":"Colombo","레소토":"Maseru","리투아니아":"Vilnius","룩셈부르크":"Luxembourg","라트비아":"Riga","모로코":"Rabat","모나코":"Monaco","몰도바":"Chișinău","마다가스카르":"Antananarivo","몰디브":"Malé","멕시코":"Mexico City","마셜 제도":"Majuro","말리":"Bamako","몰타":"Valletta","몽골":"Ulan Bator","북마리아나 제도":"Saipan","모잠비크":"Maputo","모리타니":"Nouakchott","몬트세라트":"Plymouth","마르티니크":"Fort-de-France","모리셔스":"Port Louis","말라위":"Lilongwe","말레이시아":"Kuala Lumpur","마요트":"Mamoudzou","나미비아":"Windhoek","뉴칼레도니아":"Nouméa","니제르":"Niamey","노퍽섬":"Kingston","나이지리아":"Abuja","니카라과":"Managua","니우에":"Alofi","네덜란드":"Amsterdam","노르웨이":"Oslo","네팔":"Kathmandu","나우루":"Yaren","뉴질랜드":"Wellington","오만":"Muscat","파키스탄":"Islamabad","파나마":"Panama City","페루":"Lima","필리핀":"Manila","팔라우":"Ngerulmud","파푸아뉴기니":"Port Moresby","폴란드":"Warsaw","푸에르토리코":"San Juan","북한":"Pyongyang","포르투갈":"Lisbon","파라과이":"Asunción","프랑스령 폴리네시아":"Papeetē","카타르":"Doha","레위니옹":"Saint-Denis","루마니아":"Bucharest","러시아":"Moscow","르완다":"Kigali","사우디아라비아":"Riyadh","수단":"Khartoum","세네갈":"Dakar","싱가포르":"Singapore","사우스조지아 사우스샌드위치 제도":"King Edward Point","스발바르제도-얀마웬섬":"Longyearbyen","솔로몬 제도":"Honiara","시에라리온":"Freetown","엘살바도르":"San Salvador","산마리노":"City of San Marino","소말리아":"Mogadishu","생피에르 미클롱":"Saint-Pierre","세르비아":"Belgrade","남수단":"Juba","수리남":"Paramaribo","슬로바키아":"Bratislava","슬로베니아":"Ljubljana","스웨덴":"Stockholm","세이셸":"Victoria","시리아":"Damascus","차드":"N'Djamena","토고":"Lomé","태국":"Bangkok","타지키스탄":"Dushanbe","토켈라우":"Fakaofo","투르크메니스탄":"Ashgabat","동티모르":"Dili","통가":"Nuku'alofa","트리니다드 토바고":"Port of Spain","튀니지":"Tunis","투발루":"Funafuti","대만":"Taipei","탄자니아":"Dodoma","우간다":"Kampala","우크라이나":"Kiev","우루과이":"Montevideo","미국":"Washington D.C.","우즈베키스탄":"Tashkent","세인트빈센트그레나딘":"Kingstown","베네수엘라":"Caracas","베트남":"Hanoi","바누아투":"Port Vila","왈리스-푸투나 제도":"Mata-Utu","사모아":"Apia","예멘":"Sana'a","남아프리카공화국":"Pretoria","잠비아":"Lusaka","짐바브웨":"Harare","코소보":"Pristina"};
const normalizeLocationSearch=value=>String(value||"").trim().toLocaleLowerCase("ko-KR").replace(/[\s._()\-]/g,"");
function countrySearchText(row){return [row.name,row.en,...(row.aliases||[])].map(normalizeLocationSearch).filter(Boolean)}
function findCountryMatch(query){
 const q=normalizeLocationSearch(query);if(!q)return null;
 const rows=WORLD_COUNTRY_DIRECTORY.map(row=>({row,keys:countrySearchText(row)}));
 return rows.find(x=>x.keys.some(k=>k===q))?.row||rows.find(x=>x.keys.some(k=>k.startsWith(q)))?.row||rows.find(x=>x.keys.some(k=>k.includes(q)))?.row||null;
}
function countryEnglishName(name){return WORLD_COUNTRY_BY_NAME[String(name||"").trim()]?.en||String(name||"").trim()}
function countryCenterCoord(name){return (PLACE_PRESETS["해외"]||{})[name]||WORLD_COUNTRY_CENTERS[name]||null}
function worldCitiesForCountry(country,current=""){
 const base=[...(WORLD_COUNTRY_CITIES[country]||[])];
 const cap=WORLD_COUNTRY_CAPITALS[country];
 if(cap&&!base.includes(cap))base.push(cap);
 if(current&&!base.includes(current))base.push(current);
 return [...new Set(base.filter(Boolean))];
}
function findSelectMatch(select,query){
 const q=normalizeLocationSearch(query);if(!q)return null;
 const rows=[...select.options].filter(o=>o.value).map(o=>({o,keys:[o.value,o.textContent].map(normalizeLocationSearch)}));
 return rows.find(x=>x.keys.some(k=>k===q))?.o||rows.find(x=>x.keys.some(k=>k.startsWith(q)))?.o||rows.find(x=>x.keys.some(k=>k.includes(q)))?.o||null;
}
function selectSearchMatch(select,query,{allowCustom=false}={}){
 const match=findSelectMatch(select,query);
 if(match){select.value=match.value;return match.value}
 const raw=String(query||"").trim();
 if(allowCustom&&raw.length>=2){
   [...select.options].filter(o=>o.dataset.searchCustom==="1").forEach(o=>o.remove());
   const o=document.createElement("option");o.value=raw;o.textContent=`직접 입력 · ${raw}`;o.dataset.searchCustom="1";select.appendChild(o);select.value=raw;return raw;
 }
 return "";
}
const WORLD_GEOCODE_CACHE_KEY="travel_world_geocode_v1";
let WORLD_GEOCODE_CACHE=(()=>{try{return JSON.parse(localStorage.getItem(WORLD_GEOCODE_CACHE_KEY)||"{}")||{}}catch(_){return {}}})();
function cachedWorldCoord(country,city){const v=WORLD_GEOCODE_CACHE[`${String(country||"").trim()}|${String(city||"").trim()}`];return Array.isArray(v)&&v.length>=2?v:null}
function cacheWorldCoord(country,city,coord){if(!Array.isArray(coord)||coord.length<2)return;WORLD_GEOCODE_CACHE[`${String(country||"").trim()}|${String(city||"").trim()}`]=coord;try{localStorage.setItem(WORLD_GEOCODE_CACHE_KEY,JSON.stringify(WORLD_GEOCODE_CACHE))}catch(_){}}
async function resolveWorldCoord(country,city){
 const known=worldCityCoord(country,city);if(known)return known;
 const countryEn=countryEnglishName(country);
 const query=[city,countryEn].filter(Boolean).join(", ");
 if(query){
  try{
   const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ko,en&q=${encodeURIComponent(query)}`;
   const res=await fetch(url,{headers:{"Accept":"application/json"},cache:"no-store"});
   if(res.ok){const rows=await res.json();const row=rows?.[0];const coord=row?[Number(row.lat),Number(row.lon)]:null;if(coord&&coord.every(Number.isFinite)){cacheWorldCoord(country,city,coord);return coord}}
  }catch(err){console.warn("World location geocoding failed",err)}
 }
 return countryCenterCoord(country);
}
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


// 해외지도에서 국가 전체가 아니라 실제 등록 도시를 표시하기 위한 좌표입니다.
const WORLD_CITY_COORDS={
 "일본|도쿄도":[35.6762,139.6503],"일본|도쿄":[35.6762,139.6503],
 "일본|오사카시":[34.6937,135.5023],"일본|오사카":[34.6937,135.5023],
 "일본|교토시":[35.0116,135.7681],"일본|교토":[35.0116,135.7681],
 "일본|삿포로시":[43.0618,141.3545],"일본|삿포로":[43.0618,141.3545],
 "일본|후쿠오카시":[33.5902,130.4017],"일본|후쿠오카":[33.5902,130.4017],
 "일본|나고야시":[35.1815,136.9066],"일본|나고야":[35.1815,136.9066],
 "일본|요코하마시":[35.4437,139.6380],"일본|요코하마":[35.4437,139.6380],
 "일본|고베시":[34.6901,135.1955],"일본|고베":[34.6901,135.1955],
 "일본|나라시":[34.6851,135.8048],"일본|나라":[34.6851,135.8048],
 "일본|나하시(오키나와)":[26.2124,127.6809],"일본|나하":[26.2124,127.6809],"일본|오키나와":[26.2124,127.6809],

 // 중국 주요 도시 - 국가 중심좌표로 잘못 표시되는 문제 방지
 "중국|베이징시":[39.9042,116.4074],"중국|베이징":[39.9042,116.4074],
 "중국|상하이시":[31.2304,121.4737],"중국|상하이":[31.2304,121.4737],
 "중국|광저우시":[23.1291,113.2644],"중국|광저우":[23.1291,113.2644],
 "중국|선전시":[22.5431,114.0579],"중국|선전":[22.5431,114.0579],
 "중국|청두시":[30.5728,104.0668],"중국|청두":[30.5728,104.0668],
 "중국|시안시":[34.3416,108.9398],"중국|시안":[34.3416,108.9398],
 "중국|칭다오시":[36.0671,120.3826],"중국|칭다오":[36.0671,120.3826],
 "중국|항저우시":[30.2741,120.1551],"중국|항저우":[30.2741,120.1551],

 // 인접 지역도 도시 좌표 우선 사용
 "대만|타이베이시":[25.0330,121.5654],"대만|신베이시":[25.0169,121.4628],
 "대만|타이중시":[24.1477,120.6736],"대만|타이난시":[22.9999,120.2270],
 "대만|가오슝시":[22.6273,120.3014],"대만|화롄시":[23.9911,121.6112],
 "홍콩|홍콩섬":[22.2783,114.1747],"홍콩|구룡":[22.3193,114.1694],"홍콩|신계":[22.4440,114.0220],
 "마카오|마카오반도":[22.1987,113.5439],"마카오|타이파":[22.1530,113.5580],"마카오|콜로안":[22.1240,113.5590]
};
function worldCityCoord(country,city){
 const key=`${String(country||'').trim()}|${String(city||'').trim()}`;
 return WORLD_CITY_COORDS[key]||cachedWorldCoord(country,city)||null;
}

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
 if(typeof tripRegionSearch!=="undefined"&&tripRegionSearch)tripRegionSearch.value=key?regionLabel(key):"";
}
function populateTripCountries(current=""){
 const countries=[...WORLD_COUNTRY_NAMES];
 if(current&&!countries.includes(current))countries.unshift(current);
 tripCountryEdit.innerHTML='<option value="">국가 선택</option>'+countries.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
 if(current)tripCountryEdit.value=current;
 if(typeof tripCountrySearch!=="undefined"&&tripCountrySearch)tripCountrySearch.value=current||"";
}
function populateTripCities(region,current=""){
 const domestic=tripTypeEdit.value==="국내";
 const key=domestic?normalizeRegionKey(region):String(region||"").trim();
 const cities=domestic?[...(KR_REGION_CITIES[key]||[])]:worldCitiesForCountry(key,current);
 if(current&&!cities.includes(current))cities.push(current);
 const optional=domestic&&METRO_REGIONS.has(key);
 tripCityEdit.innerHTML=`<option value="">${optional?"선택 안 함":domestic?"도시 선택":"도시·지역 선택"}</option>`+
   cities.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
 if(current)tripCityEdit.value=current;
 tripCityEdit.required=!optional;
 if(typeof tripCityLabel!=="undefined"&&tripCityLabel) tripCityLabel.textContent=domestic?"도시":"해외 도시·지역";
 if(typeof tripCitySearch!=="undefined"&&tripCitySearch){tripCitySearch.value=current||"";tripCitySearch.placeholder=domestic?"도시·군·구 검색":"도시·지역 검색 또는 직접 입력";}
}
function syncTripLocationFields(region="",city="",country=""){
 const domestic=tripTypeEdit.value==="국내";
 const locationRow=tripRegionWrap.parentElement;
 tripRegionWrap.hidden=!domestic;
 tripCityWrap.hidden=false;
 tripRegionEdit.required=domestic;
 if(domestic){
   // 국내: 시·도 → 도시 → 국가(대한민국) 순서를 유지합니다.
   if(locationRow&&tripCountryWrap&&locationRow.parentElement===tripCountryWrap.parentElement){
     locationRow.parentElement.insertBefore(locationRow,tripCountryWrap);
     locationRow.style.gridTemplateColumns="";
   }
   populateTripRegions(region);
   tripCountryEdit.innerHTML='<option value="대한민국">대한민국</option>';
   tripCountryEdit.value="대한민국";
   tripCountryEdit.disabled=true;
   if(typeof tripCountrySearch!=="undefined"&&tripCountrySearch){tripCountrySearch.value="대한민국";tripCountrySearch.hidden=true;tripCountrySearch.disabled=true;}
   if(typeof tripRegionSearch!=="undefined"&&tripRegionSearch){tripRegionSearch.hidden=false;tripRegionSearch.disabled=false;}
   populateTripCities(tripRegionEdit.value,city);
 }else{
   // 해외: 국가를 먼저 고른 뒤 해당 국가의 도시·지역을 선택하도록 순서를 바꿉니다.
   if(locationRow&&tripCountryWrap&&locationRow.parentElement===tripCountryWrap.parentElement){
     locationRow.parentElement.insertBefore(tripCountryWrap,locationRow);
     locationRow.style.gridTemplateColumns="1fr";
   }
   tripRegionEdit.required=false;
   tripRegionEdit.innerHTML="";
   if(typeof tripRegionSearch!=="undefined"&&tripRegionSearch){tripRegionSearch.hidden=true;tripRegionSearch.disabled=true;tripRegionSearch.value="";}
   tripCountryEdit.disabled=false;
   if(typeof tripCountrySearch!=="undefined"&&tripCountrySearch){tripCountrySearch.hidden=false;tripCountrySearch.disabled=false;}
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

// 목록은 등록순이 아니라 실제 여행/방문 날짜 기준으로 표시합니다.
const relevantDate=x=>String(x?.start_date||x?.event_date||x?.created_at||"").slice(0,10);
const chronological=(a,b)=>{
 const ad=relevantDate(a),bd=relevantDate(b);
 if(ad&&bd&&ad!==bd)return ad.localeCompare(bd);
 if(ad&&!bd)return -1;
 if(!ad&&bd)return 1;
 const an=String(a?.title||a?.place_name||a?.category||"");
 const bn=String(b?.title||b?.place_name||b?.category||"");
 return an.localeCompare(bn,"ko")||Number(a?.id||0)-Number(b?.id||0);
};
const tripLocationParts=x=>x.trip_type==="국내"
 ? {top:regionLabel(normalizeRegionKey(x.region))||"-",bottom:String(x.city||"").trim()||"-"}
 : {top:String(x.country||"-").trim()||"-",bottom:String(x.city||"").trim()||"-"};

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

// 여행지 입력명 ↔ 세계지도 GeoJSON 국가명 매핑 (전 세계 국가 지원)
const WORLD_GEO_NAME_BY_KO={...Object.fromEntries(WORLD_COUNTRY_DIRECTORY.map(x=>[x.name,x.en])),...{"미국":"United States of America","대한민국":"South Korea","북한":"North Korea","러시아":"Russia","베트남":"Vietnam","라오스":"Laos","브루나이":"Brunei","이란":"Iran","시리아":"Syria","볼리비아":"Bolivia","베네수엘라":"Venezuela","탄자니아":"Tanzania","몰도바":"Moldova","콩고-킨샤사":"Democratic Republic of the Congo","콩고-브라자빌":"Republic of the Congo","코트디부아르":"Ivory Coast","튀르키예":"Turkey","체코":"Czech Republic","팔레스타인":"Palestine","바티칸 시국":"Vatican","북마리아나 제도":"Northern Mariana Islands","마카오":"Macao","홍콩":"Hong Kong","코소보":"Kosovo"}};
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
 const n=normalizeWorldGeoName(geoName);
 // 도시/지역이 지정된 기록은 국가 전체 방문으로 보지 않습니다.
 const countryOnlyPlaces=places.filter(x=>x.place_type==='해외'&&worldGeoNameForPlace(x.place_name)===n&&!placeCities(x).length);
 if(countryOnlyPlaces.some(x=>x.status==='방문'))return 'visited';
 if(countryOnlyPlaces.some(x=>x.status==='버킷리스트'))return 'bucket';
 const countryOnlyTrips=trips.filter(x=>x.trip_type==='해외'&&worldGeoNameForPlace(x.country)===n&&!String(x.city||'').trim());
 if(countryOnlyTrips.some(x=>x.status==='완료'))return 'visited';
 if(countryOnlyTrips.some(x=>x.status==='버킷리스트'))return 'bucket';
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
 }).sort(chronological);
 const tripRows=trips.filter(x=>x.trip_type==='국내'&&normalizeRegionKey(x.region)===selectedKoreaRegion&&String(x.city||'').trim()===selectedKoreaCity).sort(chronological);
 const st=domesticMunicipalityStatus(selectedKoreaRegion,selectedKoreaCity);
 const label=st==='visited'?'방문 지역':st==='bucket'?'버킷리스트 지역':'미등록 지역';
 koreaRegion.textContent=`${regionLabel(selectedKoreaRegion)} · ${selectedKoreaCity}`;
 koreaDesc.textContent=`${label} · 여행 ${tripRows.length}건 · 방문지 기록 ${placeRows.length}건. 이 시·군/구의 실제 영역만 지도에 표시됩니다.`;
 koreaTripList.classList.add('map-region-list');
 const cards=[];
 tripRows.forEach(x=>cards.push(`<div class="map-region-item"><div><b>${esc(x.title)}</b><small>${esc(x.start_date||'')}${x.end_date?` ~ ${esc(x.end_date)}`:''}${x.memo?` · ${esc(cleanAutoRegisteredMemo(x.memo))}`:''}</small></div><span class="map-list-status ${x.status==='완료'?'visited':x.status==='버킷리스트'?'bucket':'none'}">${esc(x.status||'예정')}</span></div>`));
 placeRows.filter(x=>!isTripLinkedPlace(x)).forEach(x=>cards.push(`<div class="map-region-item"><div><b>${esc(selectedKoreaCity)}</b><small>${esc(x.memo||'직접 등록한 방문지')}</small></div><span class="map-list-status ${x.status==='방문'?'visited':'bucket'}">${esc(x.status)}</span></div>`));
 koreaTripList.innerHTML=cards.length?cards.join(''):'<div class="empty-mini">이 지역에 등록된 여행 또는 방문지 기록이 없습니다.</div>';
}
function showWorldCountry(geoName){
 selectedWorldGeoName=normalizeWorldGeoName(geoName);updateWorldCountrySource();
 const ko=worldKoreanName(selectedWorldGeoName);
 const placeRows=places.filter(x=>x.place_type==='해외'&&worldGeoNameForPlace(x.place_name)===selectedWorldGeoName).sort(chronological);
 const tripRows=trips.filter(x=>x.trip_type==='해외'&&worldGeoNameForPlace(x.country)===selectedWorldGeoName).sort(chronological);
 const status=worldCountryStatus(selectedWorldGeoName);
 const recordedCities=[...new Set([...placeRows.flatMap(placeCities),...tripRows.map(x=>String(x.city||'').trim()).filter(Boolean)])];
 worldCountry.textContent=ko;
 worldTripList.classList.add('map-region-list');
 const cards=[];
 const cityStatus=new Map();
 placeRows.forEach(x=>placeCities(x).forEach(city=>{const prev=cityStatus.get(city);if(x.status==='방문'||!prev)cityStatus.set(city,x.status)}));
 tripRows.forEach(x=>{const city=String(x.city||'').trim();if(city&&x.status==='완료')cityStatus.set(city,'방문');else if(city&&x.status==='버킷리스트'&&!cityStatus.has(city))cityStatus.set(city,'버킷리스트')});
 const visitedCityCount=recordedCities.filter(city=>cityStatus.get(city)==='방문').length;
 const bucketCityCount=recordedCities.filter(city=>cityStatus.get(city)==='버킷리스트').length;
 const countrySummary=status==='visited'?'국가 전체 방문':status==='bucket'?'국가 전체 버킷리스트':visitedCityCount?`방문 도시/지역 ${visitedCityCount}곳`:bucketCityCount?`버킷리스트 도시/지역 ${bucketCityCount}곳`:'등록된 도시/지역 없음';
 worldDesc.textContent=`${countrySummary} · 등록 도시/지역 ${recordedCities.length}곳 · 여행 ${tripRows.length}건 · 방문지 기록 ${placeRows.length}건`;
 recordedCities.forEach(city=>{const st=cityStatus.get(city)||'예정';cards.push(`<div class="map-region-item"><div><b>${esc(city)}</b><small>${esc(ko)} · 등록된 도시/지역</small></div><span class="map-list-status ${st==='방문'?'visited':st==='버킷리스트'?'bucket':'none'}">${esc(st)}</span></div>`)});
 tripRows.forEach(x=>cards.push(`<div class="map-region-item"><div><b>${esc(x.city||x.title)}</b><small>${esc(x.title)} · ${esc(x.start_date||'')} ${x.end_date?`~ ${esc(x.end_date)}`:''}</small></div><span class="map-list-status ${x.status==='완료'?'visited':x.status==='버킷리스트'?'bucket':'none'}">${esc(x.status||'예정')}</span></div>`));
 placeRows.filter(x=>!placeCities(x).length&&!isTripLinkedPlace(x)).forEach(x=>cards.push(`<div class="map-region-item"><div><b>${esc(x.place_name)}</b><small>${esc(x.memo||'직접 등록한 방문지')}</small></div><span class="map-list-status ${x.status==='방문'?'visited':'bucket'}">${esc(x.status)}</span></div>`));
 worldTripList.innerHTML=cards.length?cards.join(''):'<div class="empty-mini">이 국가에 등록된 여행 또는 방문지 기록이 없습니다.</div>';
}

async function setupKoreaRegionLayer(){
 try{
   koreaMunicipalityBaseGeoJSON=await fetchKoreaMunicipalityGeoJSON();
   if(!koreaMap||koreaMap.getSource('travel-korea-regions'))return;
   koreaMap.addSource('travel-korea-regions',{type:'geojson',data:decorateKoreaGeoJSON()});
   const beforeLabel=firstSymbolLayerId(koreaMap);
   koreaMap.addLayer({id:'travel-korea-fill',type:'fill',source:'travel-korea-regions',paint:mapFillPaint()},beforeLabel);
   koreaMap.addLayer({id:'travel-korea-line',type:'line',source:'travel-korea-regions',paint:mapLinePaint()},beforeLabel);
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
   const beforeLabel=firstSymbolLayerId(worldMap);
   worldMap.addLayer({id:'travel-world-fill',type:'fill',source:'travel-world-countries',paint:mapFillPaint()},beforeLabel);
   worldMap.addLayer({id:'travel-world-line',type:'line',source:'travel-world-countries',paint:mapLinePaint()},beforeLabel);
   worldCountryLayerReady=true;updateWorldCountrySource();renderWorldFallbackMarkers();
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

// 모든 편집 팝업은 ESC 키로 닫을 수 있습니다.
document.addEventListener("keydown",event=>{
 if(event.key!=="Escape")return;
 const openModals=$$(".editor-modal:not([hidden])");
 if(!openModals.length)return;
 event.preventDefault();
 const topModal=openModals[openModals.length-1];
 closeModal(topModal.id);
});

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
function isTripLinkedPlace(x){
 return Number(x?.source_trip_id)>0;
}
function completedTripPlacePayload(x){
 const type=x.trip_type==="해외"?"해외":"국내";
 const region=type==="국내"?normalizeRegionKey(x.region):"";
 const city=String(x.city||"").trim();
 const country=(x.country|| (type==="국내"?"대한민국":"")).trim();
 const coord=type==="국내"
   ? (KR_CITY_COORDS[city]||(PLACE_PRESETS["국내"]||{})[region]||[36.5,127.8])
   : (worldCityCoord(country,city)||countryCenterCoord(country)||[0,0]);
 const placeName=type==="국내"?(city||regionLabel(region)||x.title):(country||x.title);
 const sourceMemo=x.memo||"";
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
 // 단방향 연동: 지역별 일정(travel_trips) → 방문지 관리(travel_places)만 허용합니다.
 // 방문지 관리에서 직접 등록한 항목은 지역별 일정으로 역생성하지 않습니다.
 const today=fmt(new Date());
 const targets=trips.filter(x=>
   Number(x.id)>0 &&
   x.end_date &&
   x.end_date<today &&
   x.status!=="버킷리스트"
 );
 if(!targets.length)return false;
 let changed=false;

 for(const trip of targets){
   try{
     // 여행 종료일이 지난 뒤에만 자동 완료 처리합니다.
     if(trip.status!=="완료"){
       await apiData("travel_trips","PUT",{...trip,status:"완료",updated_at:new Date().toISOString()},trip.id);
       trip.status="완료";
       changed=true;
     }

     // 같은 여행은 방문지 관리에 한 번만 등록합니다.
     const already=places.some(p=>isTripLinkedPlace(p)&&Number(p.source_trip_id)===Number(trip.id));
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
function compactTripLocation(x){
 if(!x)return "";
 if(x.trip_type==="국내"){
  const region=normalizeRegionKey(x.region||"");
  return [region,x.city].map(v=>String(v||"").trim()).filter(Boolean).join(" · ");
 }
 return [x.country,x.city].map(v=>String(v||"").trim()).filter(Boolean).join(" · ");
}
function compactPlaceLocation(x){
 if(!x)return "";
 const cities=placeCities(x);
 const first=cities[0]||String(x.city_name||"").trim();
 const extra=Math.max(0,cities.length-1);
 const parent=x.place_type==="국내"?normalizeRegionKey(x.region_name||""):String(x.place_name||"").trim();
 const base=[parent,first].filter(Boolean).join(" · ");
 return base+(extra?` +${extra}`:"");
}
function calendarLocationLabels(k){
 const labels=[];
 const add=value=>{const v=String(value||"").trim();if(v&&!labels.includes(v))labels.push(v)};
 trips.filter(x=>tripOnDate(x,k)).forEach(x=>add(compactTripLocation(x)));
 places.filter(x=>placeOnDate(x,k)).forEach(x=>add(compactPlaceLocation(x)));
 events.filter(x=>x.event_date===k&&x.trip_id).forEach(event=>{
  const trip=trips.find(x=>String(x.id)===String(event.trip_id));
  if(trip)add(compactTripLocation(trip));
 });
 return labels;
}
function calendarHoverItems(k){
 const rows=[];
 const seen=new Set();
 const add=(key,item)=>{if(!seen.has(key)){seen.add(key);rows.push(item)}};
 trips.filter(x=>tripOnDate(x,k)).forEach(x=>add(`trip-${x.id}`,{
  location:compactTripLocation(x),
  memo:String(x.memo||x.title||"").trim(),
  date:calendarRangeLabel(x.start_date,x.end_date)
 }));
 places.filter(x=>placeOnDate(x,k)).forEach(x=>add(`place-${x.id}`,{
  location:compactPlaceLocation(x),
  memo:String(x.memo||"").trim(),
  date:calendarRangeLabel(x.start_date,x.end_date)
 }));
 events.filter(x=>x.event_date===k).forEach(x=>{
  const trip=x.trip_id?trips.find(t=>String(t.id)===String(x.trip_id)):null;
  add(`event-${x.id}`,{
   location:trip?compactTripLocation(trip):"",
   memo:String(x.description||x.title||"").trim(),
   date:shortCalendarDate(x.event_date)
  });
 });
 return rows;
}
let calendarHoverTooltip=null;
function ensureCalendarHoverTooltip(){
 if(calendarHoverTooltip&&document.body.contains(calendarHoverTooltip))return calendarHoverTooltip;
 calendarHoverTooltip=document.createElement("div");
 calendarHoverTooltip.className="calendar-hover-tooltip";
 calendarHoverTooltip.setAttribute("role","tooltip");
 calendarHoverTooltip.hidden=true;
 document.body.appendChild(calendarHoverTooltip);
 return calendarHoverTooltip;
}
function hideCalendarHoverTooltip(){
 if(calendarHoverTooltip)calendarHoverTooltip.hidden=true;
}
function showCalendarHoverTooltip(button,k){
 if(!window.matchMedia("(hover: hover) and (pointer: fine)").matches)return;
 const items=calendarHoverItems(k);
 if(!items.length){hideCalendarHoverTooltip();return}
 const tip=ensureCalendarHoverTooltip();
 const visible=items.slice(0,4);
 tip.innerHTML=`<div class="calendar-hover-list">${visible.map(item=>`<div class="calendar-hover-item">${item.location?`<b>${esc(item.location)}</b>`:""}${item.memo?`<span>${esc(item.memo)}</span>`:""}<small>${esc(item.date)}</small></div>`).join("")}</div>${items.length>4?`<em>외 ${items.length-4}건</em>`:""}`;
 tip.hidden=false;
 tip.style.left="0px";tip.style.top="0px";
 const r=button.getBoundingClientRect(),tr=tip.getBoundingClientRect();
 const gap=8,pad=8;
 let left=r.left+r.width/2-tr.width/2;
 left=Math.max(pad,Math.min(left,window.innerWidth-tr.width-pad));
 let top=r.top-tr.height-gap;
 if(top<pad)top=r.bottom+gap;
 top=Math.max(pad,Math.min(top,window.innerHeight-tr.height-pad));
 tip.style.left=`${Math.round(left)}px`;tip.style.top=`${Math.round(top)}px`;
}
function renderCalendar(){
 const y=cal.getFullYear(),m=cal.getMonth();monthTitle.textContent=`${y}년 ${m+1}월`;
 const first=new Date(y,m,1),start=new Date(y,m,1-first.getDay()),today=fmt(new Date());
 let html="";
 for(let i=0;i<42;i++){
   const d=new Date(start);d.setDate(start.getDate()+i);
   const k=fmt(d),dow=d.getDay(),holiday=getKoreanHolidays(d.getFullYear())[k]||"";
   const has=events.some(x=>x.event_date===k)||trips.some(x=>tripOnDate(x,k))||places.some(x=>placeOnDate(x,k));
   const locationLabels=has?calendarLocationLabels(k):[];
   const primaryLocation=locationLabels[0]||"";
   const moreLocations=Math.max(0,locationLabels.length-1);
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
   const dayTitleText=[holiday,...locationLabels].filter(Boolean).join(" / ");
   html+=`<button class="${cls}" data-date="${k}" title="${esc(dayTitleText)}"><span>${d.getDate()}</span>${holiday?`<small class="holiday-name">${esc(holiday)}</small>`:""}${primaryLocation?`<small class="day-location">${esc(primaryLocation)}${moreLocations?` <b>+${moreLocations}</b>`:""}</small>`:""}</button>`;
 }
 calendarGrid.innerHTML=html;
 $$(".day").forEach(b=>{
  b.onclick=()=>{hideCalendarHoverTooltip();selectedDate=selectedDate===b.dataset.date?"":b.dataset.date;renderCalendar()};
  b.addEventListener("mouseenter",()=>showCalendarHoverTooltip(b,b.dataset.date));
  b.addEventListener("mouseleave",hideCalendarHoverTooltip);
  b.addEventListener("focus",()=>showCalendarHoverTooltip(b,b.dataset.date));
  b.addEventListener("blur",hideCalendarHoverTooltip);
 });
 renderDay();
}
window.addEventListener("scroll",hideCalendarHoverTooltip,{passive:true});
window.addEventListener("resize",hideCalendarHoverTooltip);
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

const MAP_BASE_STYLE="https://tiles.openfreemap.org/styles/bright";
function applyEnglishFirstMapLabels(map){
 try{
  const layers=map.getStyle()?.layers||[];
  layers.forEach(layer=>{
   if(layer.type!=="symbol"||!layer.layout?.["text-field"])return;
   if((layer["source-layer"]||"")!=="place")return;
   try{map.setLayoutProperty(layer.id,"text-field",["coalesce",["get","name_en"],["get","name:latin"],["get","name"]])}catch(_){ }
  });
 }catch(_){ }
}
function firstSymbolLayerId(map){
 return (map.getStyle()?.layers||[]).find(layer=>layer.type==="symbol")?.id;
}

function ensureKoreaMap(){
 if(koreaMap || typeof maplibregl==="undefined") return;
 koreaMap=new maplibregl.Map({
   container:"koreaRealMap",
   style:MAP_BASE_STYLE,
   center:[127.8,36.3],
   zoom:6.1,
   minZoom:5,
   maxZoom:12
 });
 koreaMap.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-left");
 ensureMapLegend('koreaRealMap');
 koreaMap.on('load',()=>{applyEnglishFirstMapLabels(koreaMap);setupKoreaRegionLayer()});
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
   style:MAP_BASE_STYLE,
   center:[10,20],
   zoom:1.3,
   minZoom:1,
   maxZoom:8
 });
 worldMap.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-left");
 ensureMapLegend('worldRealMap');
 worldMap.on('load',()=>{applyEnglishFirstMapLabels(worldMap);setupWorldCountryLayer()});
}
function renderWorldFallbackMarkers(){
 if(!worldMap)return;clearMapMarkers(worldMapMarkers);
 const markerRows=new Map();
 const addCity=(country,city,status,lat=null,lng=null)=>{
   country=String(country||'').trim();city=String(city||'').trim();if(!country||!city)return;
   const coord=worldCityCoord(country,city);
   const useLat=coord?.[0]??Number(lat),useLng=coord?.[1]??Number(lng);
   if(!Number.isFinite(Number(useLat))||!Number.isFinite(Number(useLng)))return;
   const key=`${country}|${city}`;const prev=markerRows.get(key);
   if(!prev||status==='방문')markerRows.set(key,{country,city,status,lat:Number(useLat),lng:Number(useLng)});
 };
 places.filter(x=>x.place_type==='해외').forEach(x=>{
   const cities=placeCities(x);
   cities.forEach(city=>addCity(x.place_name,city,x.status,x.latitude,x.longitude));
   if(!cities.length&&!worldCountryLayerReady)addCity(x.place_name,x.place_name,x.status,x.latitude,x.longitude);
 });
 trips.filter(x=>x.trip_type==='해외').forEach(x=>{
   const city=String(x.city||'').trim();if(city)addCity(x.country,city,x.status==='완료'?'방문':x.status==='버킷리스트'?'버킷리스트':'예정');
 });
 markerRows.forEach(x=>{
   const el=markerElement(x.status==='방문'?'방문':'버킷리스트');
   el.title=`${x.country} · ${x.city} · ${x.status}`;
   const marker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([x.lng,x.lat]).addTo(worldMap);
   el.addEventListener('click',()=>showWorldCountry(worldGeoNameForPlace(x.country)));worldMapMarkers.push(marker);
 });
}
function renderWorld(){
 ensureWorldMap();if(!worldMap)return;
 if(worldCountryLayerReady){updateWorldCountrySource();renderWorldFallbackMarkers();}
 else renderWorldFallbackMarkers();
 setTimeout(()=>worldMap.resize(),120);
}


function selectedPlaceCities(){
 const checked=[...placeCityEdit.querySelectorAll('input[type="checkbox"]:checked')].map(el=>el.value);
 const dropdown=typeof placeCityDropdown!=="undefined"&&placeCityDropdown?String(placeCityDropdown.value||"").trim():"";
 return [...new Set([...checked,...(dropdown?[dropdown]:[])])];
}
function ensurePlaceCityOption(city,checked=true){
 city=String(city||"").trim();if(!city)return;
 let input=[...placeCityEdit.querySelectorAll('input[type="checkbox"]')].find(el=>el.value===city);
 if(!input){
  const label=document.createElement("label");label.className="multi-city-option";
  label.innerHTML=`<input type="checkbox" value="${esc(city)}"/><span>${esc(city)}</span>`;placeCityEdit.appendChild(label);input=label.querySelector("input");
 }
 if(checked)input.checked=true;
 if(typeof placeCityDropdown!=="undefined"&&placeCityDropdown&&!([...placeCityDropdown.options].some(o=>o.value===city))){const o=document.createElement("option");o.value=city;o.textContent=`직접 입력 · ${city}`;placeCityDropdown.appendChild(o)}
 if(typeof placeCityDropdown!=="undefined"&&placeCityDropdown)placeCityDropdown.value=city;
}
function populatePlaceCities(parent,current=[]){
 const domestic=placeTypeEdit.value==="국내";
 const selected=new Set(Array.isArray(current)?current:(current?[current]:[]));
 const cities=domestic?[...(KR_REGION_CITIES[parent]||[])]:worldCitiesForCountry(parent,[...selected][0]||"");
 selected.forEach(c=>{if(c&&!cities.includes(c))cities.push(c)});
 placeCityEdit.innerHTML=cities.map(c=>`<label class="multi-city-option"><input type="checkbox" value="${esc(c)}" ${selected.has(c)?"checked":""}/><span>${esc(c)}</span></label>`).join("");
 if(typeof placeCityDropdown!=="undefined"&&placeCityDropdown){
   placeCityDropdown.innerHTML=`<option value="">${domestic?"지역 드롭박스 선택":"도시·지역 드롭박스 선택"}</option>`+cities.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
   const first=[...selected][0];if(first)placeCityDropdown.value=first;
 }
 if(typeof placeCitySearch!=="undefined"&&placeCitySearch){placeCitySearch.value="";placeCitySearch.placeholder=domestic?"도시·군·구 검색":"도시·지역 검색 또는 직접 입력";}
 placeCityWrap.hidden=false;
 if(typeof placeCityLabel!=="undefined"&&placeCityLabel) placeCityLabel.textContent=domestic?"도시·군·구":"해외 도시·지역";
 const help=placeCityWrap.querySelector('.multi-city-help');if(help)help.textContent=domestic?"검색 또는 드롭박스로 지역을 선택할 수 있고, 여러 지역은 복수 선택할 수 있습니다.":"검색 또는 드롭박스로 도시·지역을 선택할 수 있으며, 목록에 없으면 검색어를 직접 입력할 수 있습니다.";
}
function populatePlaceNames(type,current="",currentCities=[]){
 const names=type==="국내"?Object.keys(KR_REGION_CITIES):[...WORLD_COUNTRY_NAMES];
 if(current&&!names.includes(current))names.unshift(current);
 placeNameEdit.innerHTML='<option value="">'+(type==="국내"?'시·도 선택':'국가 선택')+'</option>'+names.map(n=>`<option value="${esc(n)}">${esc(type==="국내"?regionLabel(n):n)}</option>`).join("");
 if(current)placeNameEdit.value=current;
 if(typeof placeNameSearch!=="undefined"&&placeNameSearch){placeNameSearch.value=current?(type==="국내"?regionLabel(current):current):"";placeNameSearch.placeholder=type==="국내"?"시·도 검색":"국가 검색 (예: 일본, Japan)";}
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
 const rows=places.filter(x=>(!type||x.place_type===type)&&(!status||x.status===status)&&(`${x.place_name} ${x.region_name||""} ${placeCities(x).join(" ")} ${x.memo||""} ${x.author_name||""}`.toLowerCase().includes(q))).sort(chronological);
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
placeNameEdit.onchange=()=>{if(typeof placeNameSearch!=="undefined"&&placeNameSearch)placeNameSearch.value=placeTypeEdit.value==="국내"?regionLabel(placeNameEdit.value):placeNameEdit.value;populatePlaceCities(placeNameEdit.value)};
if(typeof placeNameSearch!=="undefined"&&placeNameSearch){placeNameSearch.addEventListener("input",()=>{const q=placeNameSearch.value.trim();let value="";if(placeTypeEdit.value==="해외"){const match=findCountryMatch(q);value=match?.name||""}else{const match=findSelectMatch(placeNameEdit,q);value=match?.value||""}if(value&&placeNameEdit.value!==value){placeNameEdit.value=value;populatePlaceCities(value)}})}
if(typeof placeCitySearch!=="undefined"&&placeCitySearch){
 placeCitySearch.addEventListener("input",()=>{const known=findSelectMatch(placeCityDropdown,placeCitySearch.value);if(known){placeCityDropdown.value=known.value;ensurePlaceCityOption(known.value,true)}else selectSearchMatch(placeCityDropdown,placeCitySearch.value,{allowCustom:placeTypeEdit.value==="해외"})});
 placeCitySearch.addEventListener("change",()=>{const value=selectSearchMatch(placeCityDropdown,placeCitySearch.value,{allowCustom:placeTypeEdit.value==="해외"});if(value)ensurePlaceCityOption(value,true)});
 placeCitySearch.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();const value=selectSearchMatch(placeCityDropdown,placeCitySearch.value,{allowCustom:placeTypeEdit.value==="해외"});if(value)ensurePlaceCityOption(value,true)}});
}
if(typeof placeCityDropdown!=="undefined"&&placeCityDropdown)placeCityDropdown.onchange=()=>{if(placeCityDropdown.value){ensurePlaceCityOption(placeCityDropdown.value,true);if(typeof placeCitySearch!=="undefined"&&placeCitySearch)placeCitySearch.value=placeCityDropdown.value}};
placeCitySelectAll.onclick=()=>placeCityEdit.querySelectorAll('input[type="checkbox"]').forEach(el=>el.checked=true);
placeCityClear.onclick=()=>{placeCityEdit.querySelectorAll('input[type="checkbox"]').forEach(el=>el.checked=false);if(typeof placeCityDropdown!=="undefined"&&placeCityDropdown)placeCityDropdown.value="";if(typeof placeCitySearch!=="undefined"&&placeCitySearch)placeCitySearch.value=""};
placeFormPublic.onsubmit=async e=>{
 e.preventDefault();clearFormError("placeFormPublic");
 const existing=placeEditId.value;const id=existing?Number(existing):null;
 const type=placeTypeEdit.value;
 const region=type==="국내"?placeNameEdit.value:"";
 const cities=selectedPlaceCities();
 if(!cities.length){showFormError("placeFormPublic",new Error(type==="국내"?"방문한 도시·군·구를 하나 이상 선택해 주세요.":"방문한 해외 도시·지역을 하나 이상 선택해 주세요."));return}
 const city=cities[0]||"";
 const name=type==="국내"?(city||region):placeNameEdit.value;
 const coord=type==="국내"?(KR_CITY_COORDS[city]||(PLACE_PRESETS["국내"]||{})[region]):await resolveWorldCoord(name,city);
 if(!coord){showFormError("placeFormPublic",new Error("선택한 해외 도시·지역의 위치를 확인할 수 없습니다. 도시명을 조금 더 정확하게 입력해 주세요."));return}
 const now=new Date().toISOString();
 const startDate=placeStartEdit.value||null,endDate=placeEndEdit.value||startDate;
 if(startDate&&endDate&&endDate<startDate){showFormError("placeFormPublic",new Error("종료일은 방문/계획일보다 빠를 수 없습니다."));return}
 const existingPlace=id?places.find(v=>Number(v.id)===Number(id)):null;
 // 직접 등록한 방문지는 source_trip_id를 만들지 않습니다.
 // 과거 지역별 일정에서 자동 생성된 방문지만 기존 source_trip_id를 유지합니다.
 const p={place_type:type,status:placeStatusEdit.value,place_name:name,region_name:region,city_name:city,city_names:cities,latitude:coord[0],longitude:coord[1],start_date:startDate,end_date:endDate,author_name:placeAuthorEdit.value.trim(),memo:placeMemoEdit.value.trim(),source_trip_id:isTripLinkedPlace(existingPlace)?Number(existingPlace.source_trip_id):null,updated_at:now};
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
 const list=trips
   .filter(x=>(!type||x.trip_type===type)&&(!status||x.status===status)&&(`${x.title} ${x.city||""} ${x.country||""} ${x.region||""}`.toLowerCase().includes(q)))
   .sort(chronological);
 tripBoard.innerHTML=list.length?list.map(x=>{
   const loc=tripLocationParts(x);
   return `<div class="board-row" data-trip="${x.id}"><span>${esc(x.trip_type)}</span><div class="board-location"><strong>${esc(loc.top)}</strong><small>${esc(loc.bottom)}</small></div><b>${esc(x.title)}${x.author_name?` <small class="author-note">by ${esc(x.author_name)}</small>`:""}</b><time>${x.start_date||""}${x.end_date?` ~ ${x.end_date}`:""}</time><span class="status-chip ${x.status==="버킷리스트"?"bucket":x.status==="완료"?"done":""}">${esc(x.status||"예정")}</span></div>`;
 }).join(""):'<div class="empty-mini">조건에 맞는 여행이 없습니다.</div>';
 $$("#tripBoard [data-trip]").forEach(el=>el.onclick=()=>editTrip(Number(el.dataset.trip)));
}
boardSearch.oninput=renderBoard;boardType.onchange=renderBoard;boardStatus.onchange=renderBoard;
function renderBudgetOptions(){const options=[...trips].sort(chronological).map(x=>`<option value="${x.id}">${esc(x.title)}</option>`).join("");budgetTripSelect.innerHTML=`<option value="">전체 여행</option>${options}`;if(selectedBudgetTrip)budgetTripSelect.value=selectedBudgetTrip}
function renderBudget(){
 const id=budgetTripSelect.value;selectedBudgetTrip=id;const list=budgets.filter(x=>!id||String(x.trip_id)===String(id)).sort((a,b)=>{const ta=trips.find(t=>String(t.id)===String(a.trip_id)),tb=trips.find(t=>String(t.id)===String(b.trip_id));return chronological(ta||a,tb||b)||Number(a.sort_order||0)-Number(b.sort_order||0)}),total=list.reduce((s,x)=>s+Number(x.budget_amount||0),0),spent=list.reduce((s,x)=>s+Number(x.spent_amount||0),0),remain=total-spent,rate=total?Math.round(spent/total*100):0;
 budgetTotal.textContent=money(total);budgetSpent.textContent=money(spent);budgetRemain.textContent=money(remain);budgetRate.textContent=rate+"%";
 budgetTable.innerHTML=`<div class="budget-row head"><span>항목</span><span>예산</span><span>지출</span><span>잔액</span></div>`+(list.length?list.map(x=>`<div class="budget-row" data-budget="${x.id}"><b>${esc(x.category)}${x.author_name?` <small class="author-note">by ${esc(x.author_name)}</small>`:""}</b><span>${money(x.budget_amount)}</span><span>${money(x.spent_amount)}</span><span>${money(Number(x.budget_amount)-Number(x.spent_amount))}</span></div>`).join(""):'<div class="empty-mini">등록된 예산이 없습니다.</div>');
 $$("#budgetTable [data-budget]").forEach(el=>el.onclick=()=>editBudget(Number(el.dataset.budget)));
}
budgetTripSelect.onchange=renderBudget;
function fillEditTripSelects(){const o='<option value="">미지정</option>'+[...trips].sort(chronological).map(x=>`<option value="${x.id}">${esc(x.title)}</option>`).join("");eventTripEdit.innerHTML=o;budgetTripEdit.innerHTML=o}

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
tripRegionEdit.onchange=()=>{if(typeof tripRegionSearch!=="undefined"&&tripRegionSearch)tripRegionSearch.value=regionLabel(tripRegionEdit.value);populateTripCities(tripRegionEdit.value,"")};
tripCountryEdit.onchange=()=>{if(typeof tripCountrySearch!=="undefined"&&tripCountrySearch)tripCountrySearch.value=tripCountryEdit.value;if(tripTypeEdit.value==="해외")populateTripCities(tripCountryEdit.value,"")};
tripCityEdit.onchange=()=>{if(typeof tripCitySearch!=="undefined"&&tripCitySearch)tripCitySearch.value=tripCityEdit.value};
if(typeof tripCountrySearch!=="undefined"&&tripCountrySearch)tripCountrySearch.addEventListener("input",()=>{const match=findCountryMatch(tripCountrySearch.value);if(match&&tripCountryEdit.value!==match.name){tripCountryEdit.value=match.name;populateTripCities(match.name,"")}});
if(typeof tripRegionSearch!=="undefined"&&tripRegionSearch)tripRegionSearch.addEventListener("input",()=>{const match=findSelectMatch(tripRegionEdit,tripRegionSearch.value);if(match&&tripRegionEdit.value!==match.value){tripRegionEdit.value=match.value;populateTripCities(match.value,"")}});
if(typeof tripCitySearch!=="undefined"&&tripCitySearch){
 tripCitySearch.addEventListener("input",()=>selectSearchMatch(tripCityEdit,tripCitySearch.value,{allowCustom:tripTypeEdit.value==="해외"}));
 tripCitySearch.addEventListener("change",()=>selectSearchMatch(tripCityEdit,tripCitySearch.value,{allowCustom:tripTypeEdit.value==="해외"}));
}
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
 if(tripTypeEdit.value==="해외"&&!tripCity){showFormError("tripFormPublic",new Error("해외 도시·지역을 선택하거나 검색어로 직접 입력해 주세요."));return}
 if(tripTypeEdit.value==="해외"&&tripCity)await resolveWorldCoord(tripCountry,tripCity);
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
