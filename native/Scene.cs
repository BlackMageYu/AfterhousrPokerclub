using System;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
namespace AfterHours {
public partial class MainWindow {
 Brush SceneForLevel(){string level=Session["config"]["stakeLevel"].S;string file=Path.Combine(root,"assets","scenes","table-"+(level==""?"low":level)+".png");var scene=Image(file);return scene==null?TableBackground():new ImageBrush(scene){Stretch=Stretch.Fill};}
 void ExportScenes(){string directory=Path.Combine(root,"assets","scenes");Directory.CreateDirectory(directory);string[] levels={"low","mid","high","master","top"};Color[] tones={Colors.Transparent,Color.FromArgb(18,15,92,134),Color.FromArgb(24,4,40,103),Color.FromArgb(22,76,30,93),Color.FromArgb(22,151,119,25)};for(int i=0;i<5;i++){var visual=new DrawingVisual();RenderOptions.SetEdgeMode(visual,EdgeMode.Aliased);using(DrawingContext dc=visual.RenderOpen()){dc.DrawRectangle(TableBackground(),null,new Rect(0,0,1500,773.4375));if(i>0)dc.DrawRoundedRectangle(new SolidColorBrush(tones[i]),null,new Rect(292,150,900,374),180,180);}var bitmap=new RenderTargetBitmap(3000,1547,192,192,PixelFormats.Pbgra32);bitmap.Render(visual);var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));using(var file=File.Create(Path.Combine(directory,"table-"+levels[i]+".png")))encoder.Save(file);}bitmapCache.Clear();}
 // The restored reference plate already has the target table/floor proportions.
 // Draw it as one continuous image to avoid texture seams from piecewise scaling.
 Brush TableBackground(){ImageSource source=Image(Path.Combine(root,"assets","table-reference-v3.png"));return source==null?(Brush)UI.Brush("#12392E"):new ImageBrush(source){Stretch=Stretch.Fill};}
}
}
