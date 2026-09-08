using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Media.Effects;
using System.Windows.Media.Animation;

namespace AfterHours {
public partial class MainWindow {
 Canvas table;
 FrameworkElement Card(string card,double width=57,bool highlight=false){bool back=string.IsNullOrEmpty(card)||card=="??";string rank=back?"":card.Substring(0,1)=="T"?"10":card.Substring(0,1),suit=back?"":card.Substring(1,1);string symbol=suit=="s"?"♠":suit=="h"?"♥":suit=="d"?"♦":"♣";Brush color=suit=="h"||suit=="d"?UI.Brush("#CC163E"):UI.Brush("#101624");double height=width*(back?1.38:1.52);var g=new Grid{Width=width,Height=height,ClipToBounds=true};ImageSource face=back?null:CardFace(card);var b=new Border{Background=back?UI.Brush("#343C51"):face==null?UI.Brush("#F9F9F7"):Brushes.Transparent,BorderBrush=back?UI.Brush("#8190AA"):Brushes.Transparent,BorderThickness=new Thickness(back?1:0),CornerRadius=new CornerRadius(4)};g.Children.Add(b);if(back){var pattern=new Canvas{Width=width-8,Height=height-8,ClipToBounds=true};for(int y=-30;y<100;y+=12){var line=new Polyline{Stroke=UI.Brush("#63718C"),StrokeThickness=1,Points=new PointCollection{new Point(0,y),new Point(width/2-4,y+width/3),new Point(width-8,y)}};pattern.Children.Add(line);}g.Children.Add(pattern);}else if(face!=null){g.Children.Add(new System.Windows.Controls.Image{Source=face,Width=width,Height=height,Stretch=Stretch.Fill});}else{var t=UI.Text(rank,width*.4,color,true);t.Margin=new Thickness(5,1,0,0);t.VerticalAlignment=VerticalAlignment.Top;g.Children.Add(t);var s=UI.Text(symbol,width*.57,color);s.HorizontalAlignment=HorizontalAlignment.Right;s.VerticalAlignment=VerticalAlignment.Bottom;s.Margin=new Thickness(0,0,3,2);g.Children.Add(s);}if(highlight){var glow=new Border{BorderBrush=UI.Gold,BorderThickness=new Thickness(3),CornerRadius=new CornerRadius(4)};glow.Effect=new DropShadowEffect{Color=UI.Brush("#FFDA52").Color,BlurRadius=12,ShadowDepth=0,Opacity=1};g.Children.Add(glow);}g.Margin=new Thickness(3);return g;}
 StackPanel Cards(IEnumerable<J> cards,double width=57,IEnumerable<string> best=null,int count=0){var p=UI.Stack(true);var list=cards.Select(x=>x.S).ToList();while(list.Count<count)list.Add("");var gold=new HashSet<string>(best??Enumerable.Empty<string>());foreach(string c in list)p.Children.Add(Card(c,width,gold.Contains(c)));return p;}
}
}
