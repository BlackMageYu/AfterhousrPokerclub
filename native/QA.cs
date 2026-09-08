using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace AfterHours {
public partial class MainWindow {
 void QARequire(bool condition,string message){if(!condition)throw new InvalidOperationException("Native QA: "+message);}
 int VisualCount<T>(DependencyObject parent) where T:DependencyObject {int count=parent is T?1:0;for(int i=0;i<VisualTreeHelper.GetChildrenCount(parent);i++)count+=VisualCount<T>(VisualTreeHelper.GetChild(parent,i));return count;}
 async Task Shot(string name){await Task.Delay(120);UpdateLayout();var bitmap=new RenderTargetBitmap((int)shell.ActualWidth,(int)shell.ActualHeight,96,96,PixelFormats.Pbgra32);bitmap.Render(shell);var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));Directory.CreateDirectory(Path.Combine(root,"qa"));using(var stream=File.Create(Path.Combine(root,"qa",name+".png")))encoder.Save(stream);}
 async Task CheckTableInteractions(){
  QARequire(!Hand["legal"].Null,"hero must have a legal turn");
  QARequire(shell.RowDefinitions[1].Height.Value==0,"table status bar must not reserve a bottom margin");
  QARequire(avatarCountdown!=null&&countdownArc!=null&&countdownSeat==0,"countdown belongs to the acting avatar");QARequire(clockText!=null&&clockText.Text!="--:--:--","room remaining time is visible at the lower left");
  double deadline=Hand["actionDeadlineAt"].N;
  UpdateAvatarClock(deadline-11000);QARequire(avatarCountdown.Text=="11","avatar must show eleven seconds at a sampled deadline");
  string half=countdownArc.Data.ToString();UpdateAvatarClock(deadline-2000);QARequire(avatarCountdown.Text=="2"&&countdownArc.Data.ToString()!=half,"blue arc must shrink with the deadline");
  UpdateAvatarClock(deadline-11000);await Shot("02-countdown-11");
  if(Hand["legal"]["canRaise"].B){
   double proposed=Math.Min(betSlider.Maximum,betSlider.Minimum+Session["config"]["bb"].N*2);
   betSlider.Value=proposed;
   QARequire(raiseTo==proposed&&betInput.Text==Chips(proposed)&&((TextBlock)raiseButton.Content).Inlines.OfType<System.Windows.Documents.Run>().Last().Text==Chips(proposed),"slider, amount entry and raise caption must agree");
   betInput.Text=Chips(betSlider.Maximum+500);QARequire(CommitBetInput()&&raiseTo==betSlider.Maximum,"typed amount must clamp at the actual stack");SetBet(betSlider.Minimum);
  }
  await PauseToggle();UpdateAvatarClock();string frozen=countdownArc.Data.ToString();await Task.Delay(100);UpdateAvatarClock();QARequire(countdownArc.Data.ToString()==frozen&&avatarCountdown.Text=="Ⅱ","paused ring must remain frozen");await PauseToggle();QARequire(Hand["actionDeadlineAt"].N>deadline,"resume must shift the real deadline");
  deadline=Hand["actionDeadlineAt"].N;
  extendButton.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
  for(int i=0;busy&&i<300;i++)await Task.Delay(10);
  QARequire(!busy&&Hand["actionExtensions"].I==1&&Math.Abs(Hand["actionDeadlineAt"].N-deadline-20000)<250,"native extension button must add twenty seconds once");
  QARequire(!extendButton.IsEnabled,"extension button must disable after use");
  Render();await Shot("02-table");
 }
 async Task RunQA(){try{
  WindowStyle=WindowStyle.None;ResizeMode=ResizeMode.NoResize;WindowState=WindowState.Normal;Width=1672;Height=941;
  File.Delete(Path.Combine(root,"qa","failure.txt"));File.Delete(Path.Combine(root,"qa","result.json"));ExportScenes();HideOverlay();
  if(!Session.Null){state=await rules.Call("end",Turn("reason","QA cleanup"));Render();}
  await Shot("01-lobby");Width=1500;Height=773.4375;await Run("start",J.O("config",J.O("stakeLevel","low","seats",7,"buyBB",100,"durationMinutes",15,"straddleEnabled",true)));
  if(!Hand["actor"].Null&&Hand["actor"].I!=0){state=await rules.Call("tick",Turn("botTiming",true));Render();if(!Hand["botTiming"].Null){double started=Hand["botTiming"]["startedAt"].N;UpdateAvatarClock(started);QARequire(countdownSeat==Hand["actor"].I&&avatarCountdown.Text=="20","bot countdown always begins at the private twenty-second display");UpdateAvatarClock(started+7000);QARequire(avatarCountdown.Text=="13","bot display countdown never exposes its real think time");await Shot("10-bot-countdown");}}
  int steps=0;while(Hand["actor"].I!=0&&Hand["status"].S=="playing"&&steps++<30)state=await rules.Call("tick",Turn());
  Render();await CheckTableInteractions();compactReviewButton.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));for(int i=0;dialogCount==0&&i<100;i++)await Task.Delay(10);QARequire(dialogCount==1&&compactReviewPaused,"double-A button click opens the current-hand compact review and pauses play");await Shot("05-compact-live");CloseCompactReview();for(int i=0;(dialogCount>0||compactReviewPaused)&&i<100;i++)await Task.Delay(10);QARequire(dialogCount==0&&!compactReviewPaused,"closing current-hand compact review resumes play");ShowBank();UpdateLayout();int bankSliders=VisualCount<Slider>(overlay),bankInputs=VisualCount<TextBox>(overlay);QARequire(dialogCount==1&&bankSliders==2&&bankInputs==0,"chip management uses two slider controls without amount text fields (sliders="+bankSliders+", inputs="+bankInputs+")");await Shot("13-bank-sliders");HideOverlay();ShowGameConfirm("退出游戏","确定要退出 AfterHours 吗？\n当前进度会被安全保存。","退出",()=>{});UpdateLayout();QARequire(dialogCount==1&&VisualCount<System.Windows.Shapes.Line>(overlay)>=2,"game-styled confirmation uses a vector close X");await Shot("14-game-confirm");HideOverlay();await ShowSettings();await Shot("03-settings");HideOverlay();ShowPlayer(Session["players"][1]);await Shot("04-profile");HideOverlay();
  ShowHeroStats();QARequire(dialogCount==1&&state["profile"]["pokerStats"].Value!=null,"hero avatar opens long-term VPIP and PFR");await Shot("15-hero-stats");HideOverlay();
  steps=0;while(Hand["status"].S=="playing"&&steps++<160){if(!Hand["legal"].Null)state=await rules.Call("action",Turn("action",Hand["legal"]["canCheck"].B?"check":"call"));else state=await rules.Call("tick",Turn());}
  QARequire(Hand["status"].S=="complete","hand must complete");Render();QARequire(dialogCount==0,"hand settlement must not automatically open compact review");QARequire(compactReviewButton!=null&&compactReviewButton.Content is Canvas,"transparent double-A compact-review icon is available beside the table menu");QARequire(animationLayer!=null&&animationLayer.Children.Count>0,"settlement creates the chip-payout animation layer");J shown=Hand["results"].Items.FirstOrDefault(x=>!x["folded"].B)??new J(null);int shownId=shown["playerId"].I;SetShowdownHighlight(shownId);HashSet<string> best=BestCardsFor(shownId);int glowCount=best.Sum(card=>showdownCardViews.ContainsKey(card)?showdownCardViews[card].OfType<Canvas>().Sum(canvas=>canvas.Children.OfType<Border>().Count(child=>(child.Tag as string)=="showdown-glow")):0);QARequire(best.Count==5&&glowCount>=5,"showdown avatar hover highlights all five made cards");ClearShowdownHighlight();await ShowCompact();QARequire(dialogCount==1,"in-table compact review opens for a completed hand");await Shot("05-compact");HideOverlay();state=await rules.Call("end",Turn("reason","原生端到端验收"));QARequire(state["lastSummary"]["reason"].S=="原生端到端验收","UTF-8 request text survives the native-to-rules bridge");Render();ShowSummary();await Shot("06-summary");HideOverlay();await ShowReplay();await Task.Delay(700);SetReplay(4);await Shot("07-replay");SetReplay(int.MaxValue);revealCards.IsChecked=true;SetReplay(replayIndex);await Shot("08-replay-final");HideOverlay();await ShowContacts();await Shot("09-contacts");HideOverlay();int completed=state["lastSummary"]["completedHands"].I;
  foreach(int seats in new[]{2,3,5}){await Run("start",J.O("config",J.O("stakeLevel","low","seats",seats,"buyBB",100,"durationMinutes",15,"straddleEnabled",false)));Render();QARequire(Session["players"].Items.Count()==seats,"seat-count layout must match engine state");await Shot("11-seats-"+seats);state=await rules.Call("end",Turn("reason","QA layout cleanup"));Render();}
  await Run("start",J.O("config",J.O("stakeLevel","low","seats",7,"buyBB",100,"durationMinutes",15,"straddleEnabled",true)));Width=1280;Height=720;Render();await Shot("12-table-16x9");QARequire(Math.Abs(body.ActualWidth-shell.ActualWidth)<1&&Math.Abs(body.ActualHeight-shell.ActualHeight)<1,"table must fill the client at 16:9");state=await rules.Call("end",Turn("reason","QA resize cleanup"));
  await rules.Call("shutdown");closing=true;StopAudio();rules.Dispose();
  File.WriteAllText(Path.Combine(root,"qa","result.json"),J.Json(J.O("ok",true,"hands",completed,"wallet",state["profile"]["wallet"].N,"renderer","WPF PresentationCore","transport","private child process stdio","uiChecks",new[]{"avatar-countdown","private-20-second-bot-countdown","room-remaining-time","shrinking-arc","pause-resume","timebank-button","raise-amount-sync","stack-clamp","bank-sliders","vector-close-icon","game-styled-confirmation","no-auto-compact-review","double-A-compact-review-icon","current-hand-compact-review-click","in-table-compact-review","hero-long-term-vpip-pfr","chip-payout-animation","2/3/5/7-seat-layouts","16:9-fill","compact-and-detailed-replay"})));Close();
 }catch(Exception e){Directory.CreateDirectory(Path.Combine(root,"qa"));File.WriteAllText(Path.Combine(root,"qa","failure.txt"),e.ToString());closing=true;StopAudio();if(rules!=null)rules.Dispose();Close();}}
}
}
