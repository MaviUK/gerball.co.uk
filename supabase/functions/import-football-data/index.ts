// EdgeLab football-data importer. Deploy only after configuring EDGELAB_IMPORT_TOKEN
// and SUPABASE_SERVICE_ROLE_KEY as server-side secrets. Never expose either in the browser.
// Invoke at most twice weekly, and confirm the source's terms before enabling automation.
import { createClient } from "jsr:@supabase/supabase-js@2";
const seasons=["2627","2526","2425","2324"]; const countryByLeague={"E0":"England","E1":"England","E2":"England","E3":"England","SC0":"Scotland","SC1":"Scotland","SC2":"Scotland","SC3":"Scotland","D1":"Germany","D2":"Germany","I1":"Italy","I2":"Italy","SP1":"Spain","SP2":"Spain","F1":"France","F2":"France","N1":"Netherlands","B1":"Belgium","P1":"Portugal","G1":"Greece","T1":"Turkey"}; const leagues=Object.keys(countryByLeague);
function csvRows(csv:string):Record<string,string>[] {
 const out:string[][]=[];let row:string[]=[],field="",quoted=false;
 for(let i=0;i<csv.length;i++){const ch=csv[i];if(ch==='"'){if(quoted&&csv[i+1]==='"'){field+='"';i++}else quoted=!quoted}
 else if(ch===','&&!quoted){row.push(field);field=""}
 else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&csv[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))out.push(row);row=[];field=""}
 else field+=ch}if(field||row.length){row.push(field);out.push(row)}
 const headers=out.shift()||[];return out.map(values=>Object.fromEntries(headers.map((h,i)=>[h.trim(),(values[i]||"").trim()])));
}
function isoDate(value:string):string|null {const m=value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);if(!m)return null;const year=Number(m[3])<100?(Number(m[3])>=70?1900:2000)+Number(m[3]):Number(m[3]);const d=new Date(Date.UTC(year,Number(m[2])-1,Number(m[1])));return d.getUTCFullYear()===year&&d.getUTCMonth()===Number(m[2])-1&&d.getUTCDate()===Number(m[1])?d.toISOString().slice(0,10):null}
function num(v:string):number|null {const n=Number(v);return v!==""&&Number.isFinite(n)&&n>=0?n:null}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return new Response("Method not allowed",{status:405});
 const expected=Deno.env.get("EDGELAB_IMPORT_TOKEN");
 if(!expected||req.headers.get("x-edgelab-import-token")!==expected)return new Response("Unauthorized",{status:401});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return new Response("Missing server configuration",{status:500});
 const db=createClient(url,key,{auth:{persistSession:false}});
 const input=await req.json().catch(()=>({})); const selected=typeof input.season==="string" && /^\d{4}$/.test(input.season) ? [input.season] : seasons; const selectedLeagues=typeof input.league==="string" && leagues.includes(input.league) ? [input.league] : leagues;
 const summary=[];
 for(const season of selected) for(const league of selectedLeagues){
  const csvUrl=`https://www.football-data.co.uk/mmz4281/${season}/${league}.csv`;
  try{
   const res=await fetch(csvUrl,{headers:{"User-Agent":"EdgeLab personal research importer"}});
   if(!res.ok)throw new Error(`Source HTTP ${res.status}`);
   const parsed=csvRows(await res.text());const records=parsed.filter(r=>r.Div===league&&r.HomeTeam&&r.AwayTeam&&isoDate(r.Date)&&["H","D","A"].includes(r.FTR)).map(r=>({
    season,league,country:countryByLeague[league],match_date:isoDate(r.Date),home_team:r.HomeTeam,away_team:r.AwayTeam,full_time_result:r.FTR,
    home_goals:num(r.FTHG),away_goals:num(r.FTAG),exchange_home:num(r.BFECH),exchange_draw:num(r.BFECD),exchange_away:num(r.BFECA),source:"football-data.co.uk",source_data:r
   }));
   let saved=0;for(let i=0;i<records.length;i+=200){const {error}=await db.from("matches").upsert(records.slice(i,i+200),{onConflict:"league,season,match_date,home_team,away_team"});if(error)throw error;saved+=Math.min(200,records.length-i)}
   summary.push({season,league,saved});
  }catch(e){summary.push({season,league,error:e instanceof Error ? e.message : JSON.stringify(e)})}
 }
 return Response.json({summary});
});
