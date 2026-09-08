using System;
using System.IO;
using System.Linq;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Markup;

namespace AfterHours {
public sealed class J {
 public object Value; public J(object value){Value=value;}
 public J this[string key]{get{var d=Value as IDictionary<string,object>;object v;return new J(d!=null&&d.TryGetValue(key,out v)?v:null);}}
 public J this[int index]{get{return Items.ElementAtOrDefault(index)??new J(null);}}
 public string S{get{return Value==null?"":Convert.ToString(Value,System.Globalization.CultureInfo.InvariantCulture);}}
 public double N{get{double n;return double.TryParse(S,System.Globalization.NumberStyles.Any,System.Globalization.CultureInfo.InvariantCulture,out n)?n:0;}}
 public int I{get{return (int)N;}} public bool B{get{return Value is bool&&(bool)Value;}} public bool Null{get{return Value==null;}}
 public IEnumerable<J> Items{get{var a=Value as IEnumerable;return a!=null&&!(Value is string)&&!(Value is IDictionary)?a.Cast<object>().Select(x=>new J(x)):Enumerable.Empty<J>();}}
 public static J Parse(string s){return new J(new JavaScriptSerializer{MaxJsonLength=int.MaxValue,RecursionLimit=300}.DeserializeObject(s));}
 public static string Json(object o){return new JavaScriptSerializer{MaxJsonLength=int.MaxValue,RecursionLimit=300}.Serialize(o is J?((J)o).Value:o);}
 public static Dictionary<string,object> O(params object[] pairs){var d=new Dictionary<string,object>();for(int i=0;i<pairs.Length;i+=2)d[(string)pairs[i]]=pairs[i+1] is J?((J)pairs[i+1]).Value:pairs[i+1];return d;}
}
public sealed class RulesClient : IDisposable {
 Process process;SemaphoreSlim writeGate=new SemaphoreSlim(1,1);ConcurrentDictionary<int,TaskCompletionSource<J>> pending=new ConcurrentDictionary<int,TaskCompletionSource<J>>();int sequence;public string Root;
 void CompleteResponse(string line){if(string.IsNullOrWhiteSpace(line))return;try{J result=J.Parse(line);TaskCompletionSource<J> request;if(!pending.TryRemove(result["id"].I,out request))return;if(!result["error"].Null)request.TrySetException(new Exception(result["error"].S));else request.TrySetResult(result["value"]);}catch(Exception e){foreach(KeyValuePair<int,TaskCompletionSource<J>> pair in pending){TaskCompletionSource<J> request;if(pending.TryRemove(pair.Key,out request))request.TrySetException(new Exception("规则进程返回了无效数据。",e));}}}
 public RulesClient(string root,string dataRoot){Root=root;var p=new ProcessStartInfo(System.IO.Path.Combine(root,"runtime","rules.exe"),"\""+System.IO.Path.Combine(root,"native","bridge.mjs")+"\"");p.WorkingDirectory=root;p.UseShellExecute=false;p.CreateNoWindow=true;p.RedirectStandardInput=true;p.RedirectStandardOutput=true;p.RedirectStandardError=true;p.StandardOutputEncoding=Encoding.UTF8;p.StandardErrorEncoding=Encoding.UTF8;if(!string.IsNullOrEmpty(dataRoot))p.Arguments+=" \""+dataRoot+"\"";process=Process.Start(p);process.OutputDataReceived+=(s,e)=>CompleteResponse(e.Data);process.ErrorDataReceived+=(s,e)=>{if(!string.IsNullOrEmpty(e.Data))try{File.AppendAllText(System.IO.Path.Combine(dataRoot??root,"rules-errors.log"),e.Data+Environment.NewLine);}catch{}};process.BeginOutputReadLine();process.BeginErrorReadLine();}
 public async Task<J> Call(string command,object body=null){if(process.HasExited)throw new Exception("规则进程已经关闭。请重新启动 AfterHours 恢复存档。");int id=Interlocked.Increment(ref sequence);var request=new TaskCompletionSource<J>();if(!pending.TryAdd(id,request))throw new Exception("内部消息编号冲突");try{await writeGate.WaitAsync();try{if(process.HasExited)throw new Exception("规则进程已经关闭。请重新启动 AfterHours 恢复存档。");byte[] utf8=Encoding.UTF8.GetBytes(J.Json(J.O("id",id,"command",command,"body",body))+"\n");await process.StandardInput.BaseStream.WriteAsync(utf8,0,utf8.Length);await process.StandardInput.BaseStream.FlushAsync();}finally{writeGate.Release();}return await request.Task;}catch{TaskCompletionSource<J> removed;pending.TryRemove(id,out removed);throw;}}
 public void Dispose(){try{foreach(KeyValuePair<int,TaskCompletionSource<J>> pair in pending){TaskCompletionSource<J> request;if(pending.TryRemove(pair.Key,out request))request.TrySetException(new Exception("规则进程已关闭。"));}process.StandardInput.Close();if(!process.WaitForExit(2500))process.Kill();process.Dispose();}catch{}}
}
public static class UI {
 public static double Scale=1; public static Brush Ink=Brush("#F5F1E7"),Muted=Brush("#A6ADA6"),Panel=Brush("#0D1B19"),Blue=Brush("#20C78B"),Gold=Brush("#E5C16B");
 public static SolidColorBrush Brush(string s){return (SolidColorBrush)new BrushConverter().ConvertFromString(s);}
 public static TextBlock Text(string text,double size=16,Brush color=null,bool bold=false){return new TextBlock{Text=text,FontSize=size*Scale,Foreground=color??Ink,FontWeight=bold?FontWeights.SemiBold:FontWeights.Normal,TextWrapping=TextWrapping.Wrap,VerticalAlignment=VerticalAlignment.Center};}
 public static Canvas CloseIcon(double size=18,Brush color=null){var c=new Canvas{Width=size,Height=size,IsHitTestVisible=false};var brush=color??Ink;double inset=size*.22;c.Children.Add(new Line{X1=inset,Y1=inset,X2=size-inset,Y2=size-inset,Stroke=brush,StrokeThickness=Math.Max(1.7,size*.11),StrokeStartLineCap=PenLineCap.Round,StrokeEndLineCap=PenLineCap.Round});c.Children.Add(new Line{X1=size-inset,Y1=inset,X2=inset,Y2=size-inset,Stroke=brush,StrokeThickness=Math.Max(1.7,size*.11),StrokeStartLineCap=PenLineCap.Round,StrokeEndLineCap=PenLineCap.Round});return c;}
 public static StackPanel Stack(bool horizontal=false){return new StackPanel{Orientation=horizontal?Orientation.Horizontal:Orientation.Vertical};}
 public static Border Box(UIElement child,Brush bg=null,double radius=10,Thickness? padding=null){return new Border{Child=child,Background=bg??Panel,CornerRadius=new CornerRadius(radius),Padding=padding??new Thickness(16)};}
 public static Button Button(string text,Action click=null,double width=double.NaN,bool primary=false){var b=new Button{Content=text,Width=width,MinHeight=42,Padding=new Thickness(17,9,17,9),Margin=new Thickness(4),Foreground=Ink,FontSize=15*Scale,FontWeight=FontWeights.SemiBold,Cursor=System.Windows.Input.Cursors.Hand,Background=primary?new LinearGradientBrush(Brush("#179A68").Color,Brush("#064C36").Color,90):new LinearGradientBrush(Brush("#1A2B29").Color,Brush("#0A1312").Color,90),BorderBrush=Brush(primary?"#55D8A5":"#314A45"),BorderThickness=new Thickness(1)};b.Template=(ControlTemplate)XamlReader.Parse("<ControlTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' TargetType='Button'><Border x:Name='frame' xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml' Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='{TemplateBinding BorderThickness}' CornerRadius='10' Padding='{TemplateBinding Padding}'><ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/></Border><ControlTemplate.Triggers><Trigger Property='IsMouseOver' Value='True'><Setter TargetName='frame' Property='Opacity' Value='0.82'/></Trigger><Trigger Property='IsPressed' Value='True'><Setter TargetName='frame' Property='Opacity' Value='0.6'/></Trigger><Trigger Property='IsEnabled' Value='False'><Setter TargetName='frame' Property='Opacity' Value='0.32'/></Trigger></ControlTemplate.Triggers></ControlTemplate>");if(click!=null)b.Click+=(s,e)=>click();return b;}
 public static ComboBox Combo(IEnumerable<string> values,int selected=0,double width=200){var c=new ComboBox{Width=width,MinHeight=38,FontSize=16,Margin=new Thickness(0,6,14,14),Foreground=Ink,Background=Brush("#142321"),BorderBrush=Brush("#49685F"),Padding=new Thickness(8,2,8,2)};c.Template=(ControlTemplate)XamlReader.Parse("<ControlTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml' TargetType='ComboBox'><Grid><ToggleButton x:Name='ToggleButton' Focusable='False' ClickMode='Press' IsChecked='{Binding Path=IsDropDownOpen,Mode=TwoWay,RelativeSource={RelativeSource TemplatedParent}}' Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='{TemplateBinding BorderThickness}' Foreground='#F5F1E7'><ToggleButton.Template><ControlTemplate TargetType='ToggleButton'><Border Background='{TemplateBinding Background}' BorderBrush='{TemplateBinding BorderBrush}' BorderThickness='{TemplateBinding BorderThickness}' CornerRadius='6'><ContentPresenter HorizontalAlignment='Stretch' VerticalAlignment='Stretch'/></Border></ControlTemplate></ToggleButton.Template><Grid><ContentPresenter Margin='12,0,34,0' HorizontalAlignment='Left' VerticalAlignment='Center' Content='{TemplateBinding SelectionBoxItem}' ContentTemplate='{TemplateBinding SelectionBoxItemTemplate}' ContentStringFormat='{TemplateBinding SelectionBoxItemStringFormat}'/><Path Data='M 0 0 L 8 0 L 4 5 Z' Fill='#E5C16B' HorizontalAlignment='Right' VerticalAlignment='Center' Margin='0,0,13,0'/></Grid></ToggleButton><Popup x:Name='Popup' Placement='Bottom' IsOpen='{Binding Path=IsDropDownOpen,RelativeSource={RelativeSource TemplatedParent}}' AllowsTransparency='True' Focusable='False' PopupAnimation='Slide'><Grid MinWidth='{Binding ActualWidth,ElementName=ToggleButton}' MaxHeight='{TemplateBinding MaxDropDownHeight}'><Border Background='#10221E' BorderBrush='#496C61' BorderThickness='1' CornerRadius='4'><ScrollViewer Margin='4' SnapsToDevicePixels='True'><ItemsPresenter/></ScrollViewer></Border></Grid></Popup></Grid></ControlTemplate>");var items=new Style(typeof(ComboBoxItem));items.Setters.Add(new Setter(Control.ForegroundProperty,Ink));items.Setters.Add(new Setter(Control.BackgroundProperty,Brush("#10221E")));items.Setters.Add(new Setter(Control.PaddingProperty,new Thickness(10,6,10,6)));c.ItemContainerStyle=items;foreach(string v in values)c.Items.Add(v);c.SelectedIndex=selected;return c;}
 public static TextBox Input(string text,double width=double.NaN){return new TextBox{Text=text,Width=width,MinHeight=38,FontSize=16,Padding=new Thickness(10,7,10,7),Background=Brush("#0A1513"),Foreground=Ink,BorderBrush=Brush("#38534C"),Margin=new Thickness(0,5,0,12)};}
 public static CheckBox Check(string text,bool value=false){return new CheckBox{Content=text,IsChecked=value,Foreground=Ink,FontSize=15,Margin=new Thickness(6,10,6,12)};}
 public static void At(Canvas canvas,UIElement e,double x,double y){canvas.Children.Add(e);Canvas.SetLeft(e,x);Canvas.SetTop(e,y);}
 public static ScrollViewer Scroll(UIElement content){return new ScrollViewer{Content=content,VerticalScrollBarVisibility=ScrollBarVisibility.Auto,HorizontalScrollBarVisibility=ScrollBarVisibility.Disabled};}
 public static BitmapImage Bitmap(string path){if(!File.Exists(path))return null;var b=new BitmapImage();b.BeginInit();b.CacheOption=BitmapCacheOption.OnLoad;b.UriSource=new Uri(path);b.EndInit();b.Freeze();return b;}
 public static string Money(double n){return "$"+n.ToString("N0");}
 public static string Street(string s){return s=="preflop"?"翻牌前":s=="flop"?"翻牌":s=="turn"?"转牌":s=="river"?"河牌":s=="showdown"?"摊牌":s;}
 public static string ActionName(string s){switch(s){case "fold":return "弃牌";case "check":return "过牌";case "call":return "跟注";case "raise":return "加注";case "bet":return "下注";case "allin":return "全下";default:return s;}}
}
public static class Program {
 [STAThread] public static void Main(string[] args){string root=AppDomain.CurrentDomain.BaseDirectory;bool qa=args.Contains("--qa");bool created;using(var mutex=new Mutex(true,qa?"Local\\AfterHours.Native.QA":"Local\\AfterHours.Native",out created)){if(!created){MessageBox.Show("AfterHours 已经运行，请从任务栏打开。","AfterHours");return;}try{var app=new Application();app.DispatcherUnhandledException+=(s,e)=>{try{File.AppendAllText(System.IO.Path.Combine(root,"native-errors.log"),e.Exception+Environment.NewLine);}catch{}MessageBox.Show(e.Exception.Message,"AfterHours");e.Handled=true;};app.Run(new MainWindow(root,qa));}catch(Exception e){File.WriteAllText(System.IO.Path.Combine(root,"startup-error.txt"),e.ToString());if(!qa)MessageBox.Show(e.Message,"AfterHours 无法启动");}}}
}
}



