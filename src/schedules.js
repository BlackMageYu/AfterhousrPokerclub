const rangePattern='(\\d{1,2}):(\\d{2})\\s*(?:–|—|-|至)\\s*(\\d{1,2}):(\\d{2})';
const toMinutes=(hour,minute)=>Math.max(0,Math.min(1439,Number(hour)*60+Number(minute)));
const parseWindow=(schedule,label)=>{
  const match=String(schedule??'').match(new RegExp(`${label}[^\\n]*?${rangePattern}`));
  if(!match)return null;
  const start=toMinutes(match[1],match[2]),end=toMinutes(match[3],match[4]);
  const duration=end>start?end-start:(end<start?1440-start+end:1440);
  return {start,end,duration};
};
export function parseDailySchedule(schedule=''){
  return {work:parseWindow(schedule,'工作'),play:parseWindow(schedule,'打牌')};
}
export function minutesOfDay(now=Date.now()){
  const date=new Date(now);return date.getHours()*60+date.getMinutes();
}
export function inScheduleWindow(minutes,window){
  if(!window)return false;
  if(window.start===window.end)return true;
  return window.start<window.end?minutes>=window.start&&minutes<window.end:minutes>=window.start||minutes<window.end;
}
export function scheduledActivity(schedule,now=Date.now()){
  const windows=(typeof schedule==='string'?parseDailySchedule(schedule):schedule)??{},minutes=minutesOfDay(now);
  // A poker slot takes priority if a poorly designed schedule overlaps work.
  if(inScheduleWindow(minutes,windows.play))return 'play';
  if(inScheduleWindow(minutes,windows.work))return 'work';
  return 'rest';
}
