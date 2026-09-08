using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Speech.Synthesis;

namespace AfterHours {
public partial class MainWindow {
 MediaPlayer musicPlayer=new MediaPlayer(),effectPlayer=new MediaPlayer(),payoutPlayer=new MediaPlayer(),voicePlayer=new MediaPlayer();SpeechSynthesizer voice=new SpeechSynthesizer();bool musicEnabled=true;Queue<string> musicQueue=new Queue<string>();string currentSong="";Random musicRandom=new Random();TextBlock musicLabel;
 void StartMusic(){musicPlayer.Volume=preferences["musicVolume"].Null?.25:preferences["musicVolume"].N;musicEnabled=preferences["musicEnabled"].Null||preferences["musicEnabled"].B;musicPlayer.MediaEnded+=(s,e)=>PlayNextMusic();musicPlayer.MediaFailed+=(s,e)=>Notice("音乐无法播放："+Path.GetFileName(currentSong));if(musicEnabled&&!qa)PlayNextMusic();}
 void PlayNextMusic(){string dir=Path.Combine(root,"music");if(!Directory.Exists(dir))Directory.CreateDirectory(dir);if(musicQueue.Count==0){var songs=Directory.GetFiles(dir,"*.mp3").OrderBy(x=>musicRandom.Next()).ToList();if(songs.Count>1&&songs[0]==currentSong){string first=songs[0];songs.RemoveAt(0);songs.Add(first);}musicQueue=new Queue<string>(songs);}if(musicQueue.Count==0){Notice("music 文件夹内没有 MP3；添加后可在音乐面板刷新。");return;}currentSong=musicQueue.Dequeue();musicPlayer.Open(new Uri(currentSong));if(musicEnabled)musicPlayer.Play();if(musicLabel!=null)musicLabel.Text=Path.GetFileNameWithoutExtension(currentSong);}
 void ShowMusic(){StackPanel p,f;var d=Dialog("音乐与音效",out p,out f);musicLabel=UI.Text(currentSong==""?"未播放":Path.GetFileNameWithoutExtension(currentSong),24,null,true);p.Children.Add(musicLabel);p.Children.Add(UI.Text("播放列表读取游戏文件夹下的 music / MP3，按轮次随机播放。",14,UI.Muted));var buttons=UI.Stack(true);buttons.Children.Add(UI.Button("播放 / 暂停",()=>{musicEnabled=!musicEnabled;if(musicEnabled){if(currentSong=="")PlayNextMusic();else musicPlayer.Play();}else musicPlayer.Pause();SavePreferences();}));buttons.Children.Add(UI.Button("随机下一首",PlayNextMusic));buttons.Children.Add(UI.Button("刷新歌单",()=>{musicQueue.Clear();PlayNextMusic();}));p.Children.Add(buttons);var volume=new Slider{Minimum=0,Maximum=1,Value=musicPlayer.Volume,Margin=new Thickness(10,20,10,25)};volume.ValueChanged+=(s,e)=>{musicPlayer.Volume=volume.Value;SavePreferences();};p.Children.Add(Field("音乐音量",volume));var effect=UI.Check("开启游戏音效和行动语音",sounds);effect.Click+=(s,e)=>{sounds=effect.IsChecked==true;SavePreferences();};p.Children.Add(effect);var tracks=Directory.GetFiles(Path.Combine(root,"music"),"*.mp3");foreach(string t in tracks)p.Children.Add(UI.Text("♫  "+Path.GetFileNameWithoutExtension(t),14,UI.Muted));ShowOverlay(d,870,650);}
 void PlayTurnPrompt(){if(!sounds||qa)return;try{System.Media.SystemSounds.Exclamation.Play();}catch{}}
 void PlayClockTick(){if(!sounds||qa)return;try{System.Media.SystemSounds.Beep.Play();}catch{}}
 void PlayChip(MediaPlayer player,string clip,double volume=.6){try{string file=Path.Combine(root,"assets","sounds","chips",clip+".mp3");if(!File.Exists(file))return;player.Open(new Uri(file));player.Volume=volume;player.Play();}catch{}}
 void PlayLargeChipSound(){if(!sounds||qa)return;PlayChip(payoutPlayer,"大量筹码",.78);}
 void PlayEventSound(){if(!sounds||qa)return;J e=Hand["events"].Items.LastOrDefault()??new J(null);string key=seenHand+"/"+e["seq"].S;if(key==lastSound||e.Null)return;lastSound=key;if(e["fastForward"].B)return;
  // Effects and voice intentionally use different players. Starting either one
  // cannot delay the other, so a call/raise voice lands over its chip sound.
  if(e["amount"].N>0){double ratio=e["amount"].N/Math.Max(1,e["potBefore"].N);PlayChip(effectPlayer,e["allIn"].B?"allin筹码":ratio<.33?"少量筹码":ratio<=.75?"中量筹码":"大量筹码");}
  try{if(e["type"].S=="board")System.Media.SystemSounds.Asterisk.Play();}catch{}
  if(e["type"].S!="action")return;try{J player=Session["players"].Items.FirstOrDefault(x=>x["id"].I==e["playerId"].I)??new J(null);string action=e["allIn"].B?"全下":UI.ActionName(e["action"].S);string gender=player["gender"].S;string cached=Path.Combine(root,"assets","voices",gender=="女"||gender=="f"?"female":"male",e["allIn"].B?"allin.mp3":e["action"].S+".mp3");if(File.Exists(cached)){voicePlayer.Open(new Uri(cached));voicePlayer.Play();}else{voice.SpeakAsyncCancelAll();try{voice.SelectVoiceByHints(gender=="女"||gender=="f"?VoiceGender.Female:VoiceGender.Male,VoiceAge.Adult,0,new System.Globalization.CultureInfo("zh-CN"));}catch{}voice.Rate=0;voice.SpeakAsync(action);}}catch{}}
 void StopAudio(){musicPlayer.Close();effectPlayer.Close();payoutPlayer.Close();voicePlayer.Close();try{voice.SpeakAsyncCancelAll();voice.Dispose();}catch{}}
}
}

