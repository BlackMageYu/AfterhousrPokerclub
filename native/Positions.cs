using System;
using System.Linq;
namespace AfterHours {public partial class MainWindow {
 string SeatPosition(int id,J hand){var ids=Session["players"].Items.Where(p=>p["status"].S!="empty"&&p["status"].S!="busted").Select(p=>p["id"].I).OrderBy(x=>(x-hand["button"].I+Session["players"].Items.Count())%Session["players"].Items.Count()).ToArray();int offset=Array.IndexOf(ids,id);string[] names=ids.Length>=7?new[]{"BTN","SB","BB","UTG","MP","HJ","CO"}:ids.Length==6?new[]{"BTN","SB","BB","UTG","HJ","CO"}:ids.Length==5?new[]{"BTN","SB","BB","UTG","CO"}:ids.Length==4?new[]{"BTN","SB","BB","CO"}:new[]{"BTN","SB","BB"};return offset>=0&&offset<names.Length?names[offset]:"空座";}
}}
