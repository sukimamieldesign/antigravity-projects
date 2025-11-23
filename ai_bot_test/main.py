import os
import csv
import datetime
import threading
import io
import tkinter as tk
import customtkinter as ctk
import google.generativeai as genai
import win32clipboard
import pyautogui
from PIL import Image, ImageTk
from dotenv import load_dotenv

# 環境変数の読み込み
load_dotenv()

# ==========================================
# GeminiのAPIキー設定
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# ==========================================

# アプリケーションの基本設定
ctk.set_appearance_mode("System")
ctk.set_default_color_theme("green")

class SnippingTool(ctk.CTkToplevel):
    """
    画面全体を覆う透明なウィンドウを作成し、ドラッグで範囲選択させるクラス。
    """
    def __init__(self, parent, callback):
        super().__init__(parent)
        self.callback = callback
        
        # 全画面設定
        self.attributes("-fullscreen", True)
        self.attributes("-alpha", 0.3)
        self.attributes("-topmost", True)
        
        # キャンバス設定
        self.canvas = tk.Canvas(self, cursor="cross", bg="black", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        
        # イベントバインド
        self.canvas.bind("<ButtonPress-1>", self.on_button_press)
        self.canvas.bind("<B1-Motion>", self.on_move_press)
        self.canvas.bind("<ButtonRelease-1>", self.on_button_release)
        self.bind("<Escape>", lambda e: self.destroy())
        
        self.start_x = None
        self.start_y = None
        self.rect = None

    def on_button_press(self, event):
        self.start_x = event.x
        self.start_y = event.y
        self.rect = self.canvas.create_rectangle(self.start_x, self.start_y, self.start_x, self.start_y, outline="red", width=2)

    def on_move_press(self, event):
        cur_x, cur_y = (event.x, event.y)
        self.canvas.coords(self.rect, self.start_x, self.start_y, cur_x, cur_y)

    def on_button_release(self, event):
        end_x, end_y = (event.x, event.y)
        x1 = min(self.start_x, end_x)
        y1 = min(self.start_y, end_y)
        x2 = max(self.start_x, end_x)
        y2 = max(self.start_y, end_y)
        
        self.destroy()
        # ウィンドウが消えるのを少し待ってから撮影
        self.after(200, lambda: self.capture_area(x1, y1, x2, y2))

    def capture_area(self, x1, y1, x2, y2):
        width = x2 - x1
        height = y2 - y1
        if width > 0 and height > 0:
            screenshot = pyautogui.screenshot(region=(x1, y1, width, height))
            self.callback(screenshot)

class App(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("IT祈祷師アシスタント")
        self.geometry("500x850")

        if not GEMINI_API_KEY:
            tk.messagebox.showerror("起動エラー", "APIキーが見つからんぞ！\n.envファイルに GEMINI_API_KEY を設定しておくれ。")
            self.destroy()
            return

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(3, weight=1)

        # システムプロンプトの読み込み
        self.system_prompt = self.load_system_prompt()
        
        # 現在の画像保持用
        self.current_image = None

        # 1. 入力エリア
        self.input_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.input_frame.grid(row=0, column=0, padx=20, pady=(10, 0), sticky="ew")
        self.input_frame.grid_columnconfigure(0, weight=1)

        self.lbl_input = ctk.CTkLabel(self.input_frame, text="相談内容 / 自分の思考 / 相手の投稿", anchor="w", font=ctk.CTkFont(weight="bold"))
        self.lbl_input.grid(row=0, column=0, sticky="w")

        # ボタン用フレーム
        self.btn_frame_top = ctk.CTkFrame(self.input_frame, fg_color="transparent")
        self.btn_frame_top.grid(row=0, column=1, sticky="e")

        self.btn_screenshot = ctk.CTkButton(self.btn_frame_top, text="📷 範囲スクショ", command=self.start_snipping, width=100, height=24, fg_color="#2980B9", hover_color="#3498DB")
        self.btn_screenshot.pack(side="left", padx=(0, 5))

        self.btn_clear = ctk.CTkButton(self.btn_frame_top, text="クリア", command=self.clear_input, width=60, height=24, fg_color="#7F8C8D", hover_color="#95A5A6")
        self.btn_clear.pack(side="left")

        self.input_box = ctk.CTkTextbox(self, height=100, font=ctk.CTkFont(size=14))
        self.input_box.grid(row=1, column=0, padx=20, pady=(5, 5), sticky="ew")
        
        # 画像プレビューエリア（入力欄の下に配置）
        self.preview_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.preview_frame.grid(row=2, column=0, padx=20, pady=(0, 5), sticky="ew")
        
        self.lbl_preview = ctk.CTkLabel(self.preview_frame, text="", height=0)
        self.lbl_preview.pack(pady=5) # 少し余白を入れる

        # 2. モード選択スイッチ
        self.switch_var = ctk.StringVar(value="off")
        self.switch_mode = ctk.CTkSwitch(self, text="返信モード（相手への打ち返し）", variable=self.switch_var, onvalue="on", offvalue="off", font=ctk.CTkFont(weight="bold"))
        self.switch_mode.grid(row=3, column=0, padx=20, pady=5, sticky="w")
        
        # 説明ラベル
        self.lbl_mode_desc = ctk.CTkLabel(self, text="OFF: 自分の思考整理＆ファクトチェック\nON: 他人の投稿へのTPS的打ち返し（ツッコミなし）", text_color="gray", justify="left")
        self.lbl_mode_desc.grid(row=4, column=0, padx=20, pady=(0, 10), sticky="w")

        # 3. 生成ボタン
        self.btn_generate = ctk.CTkButton(self, text="祈祷（回答生成）", command=self.start_generation, height=40, font=ctk.CTkFont(size=16, weight="bold"))
        self.btn_generate.grid(row=5, column=0, padx=20, pady=10)

        # 4. 出力エリア
        self.lbl_output = ctk.CTkLabel(self, text="ご隠居の回答", anchor="w", font=ctk.CTkFont(weight="bold"))
        self.lbl_output.grid(row=6, column=0, padx=20, pady=(10, 0), sticky="w")

        self.output_box = ctk.CTkTextbox(self, height=180, fg_color="#2B2B2B", font=ctk.CTkFont(size=14))
        self.output_box.grid(row=7, column=0, padx=20, pady=(5, 10), sticky="ew")

        # 5. コピーボタン群
        self.copy_btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.copy_btn_frame.grid(row=8, column=0, padx=20, pady=(0, 10))

        self.btn_copy_img = ctk.CTkButton(self.copy_btn_frame, text="画像をコピー", command=self.copy_image_to_clipboard, width=100, height=30, fg_color="#2980B9", hover_color="#3498DB")
        self.btn_copy_img.pack(side="left", padx=5)

        self.btn_copy_input = ctk.CTkButton(self.copy_btn_frame, text="入力をコピー", command=self.copy_input_to_clipboard, width=100, height=30, fg_color="#2980B9", hover_color="#3498DB")
        self.btn_copy_input.pack(side="left", padx=5)

        self.btn_copy_output = ctk.CTkButton(self.copy_btn_frame, text="回答をコピー", command=self.copy_output_to_clipboard, width=100, height=30, fg_color="#E67E22", hover_color="#D35400")
        self.btn_copy_output.pack(side="left", padx=5)

        # 6. 使用量確認リンク
        self.btn_usage = ctk.CTkButton(self, text="トークン使用量を確認 (Google AI Studio)", command=self.open_usage_page, height=30, fg_color="transparent", text_color="gray", hover_color="#2B2B2B", font=ctk.CTkFont(size=12, underline=True))
        self.btn_usage.grid(row=9, column=0, padx=20, pady=(0, 20))

        # 右クリックメニューの設定
        self.setup_context_menu(self.input_box)
        self.setup_context_menu(self.output_box)

    def load_system_prompt(self):
        try:
            with open("system_prompt.txt", "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            return "あなたはIT祈祷師です。"

    def open_usage_page(self):
        import webbrowser
        webbrowser.open("https://aistudio.google.com/")

    def start_snipping(self):
        self.iconify()
        self.after(300, lambda: SnippingTool(self, self.on_screenshot_captured))

    def on_screenshot_captured(self, image):
        self.current_image = image
        self.deiconify() 
        self.copy_image_to_clipboard(silent=True)
        self.show_preview(image)

    def show_preview(self, image):
        w, h = image.size
        aspect = w / h
        new_h = 150
        new_w = int(new_h * aspect)
        if new_w > 400: # 幅制限
            new_w = 400
            new_h = int(new_w / aspect)
        
        preview_img = ctk.CTkImage(light_image=image, dark_image=image, size=(new_w, new_h))
        self.lbl_preview.configure(image=preview_img, text="", compound="top") # テキスト削除

    def start_generation(self):
        text = self.input_box.get("0.0", "end").strip()
        if not text and self.current_image is None:
            tk.messagebox.showwarning("警告", "入力欄が空じゃよ。")
            return

        self.btn_generate.configure(state="disabled", text="儀式中...")
        self.output_box.delete("0.0", "end")
        
        mode = self.switch_var.get()
        
        thread = threading.Thread(target=self.generate_response, args=(text, mode))
        thread.start()

    def log_interaction(self, mode, model_name, input_text, output_text, status):
        log_dir = "logs"
        if not os.path.exists(log_dir):
            os.makedirs(log_dir)
        
        filepath = os.path.join(log_dir, "history.csv")
        file_exists = os.path.isfile(filepath)
        
        try:
            with open(filepath, mode='a', newline='', encoding='utf-8-sig') as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow(["Timestamp", "Mode", "Model", "Input", "Output", "Status"])
                
                timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                final_input = input_text
                if self.current_image:
                    final_input += " [Image Attached]"
                    
                writer.writerow([timestamp, mode, model_name, final_input, output_text, status])
        except Exception as e:
            print(f"Logging failed: {e}")

    def load_vocabulary(self):
        try:
            with open("vocabulary.txt", "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            return ""

    def generate_response(self, input_text, mode):
        models_to_try = ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-1.5-flash']
        
        genai.configure(api_key=GEMINI_API_KEY)

        vocab_text = self.load_vocabulary()

        additional_instruction = ""
        if mode == "off":
            additional_instruction = f"""
[モード: 知識補完・自己確認]
ユーザーの入力は「用語の確認」や「うろ覚えの知識」である。
1. 入力された用語や概念について、**正確な定義・正式名称（略語ならフルスペル）・提唱者** などを補完して解説せよ。
2. 口調はあくまで「IT祈祷師のご隠居」を崩すな。
3. 最後に少しだけTPS視点での一言（本質的なコメント）を添えよ。
4. 【重要】出力は必ず140文字以内に収めよ（ハッシュタグ含む）。
"""
        else:
            additional_instruction = f"""
[モード: 他人への返信]
ユーザーの入力は「他人の投稿」である。
1. 相手の文脈に寄り添いつつ、「構造化」「目的回帰」「現場擁護」のいずれかの視点で打ち返せ。
2. **相手は必ずしもIT専門家ではない。初学者にも伝わるよう、専門用語は避け、分かりやすく噛み砕いて説明せよ。**
3. 以下の[用語集]は「比喩表現の参考」として使い、必ずしも強制的に置換する必要はない。文脈に合わせて自然に使え。
   - 相手が理解できなさそうな場合は、無理に使わず平易な言葉を選べ。

[用語集]
{vocab_text}

4. 【重要】相手の知識不足や間違いに対する「野暮なツッコミ（ファクトチェック）」は絶対に行うな。
5. 【重要】出力は必ず140文字以内に収めよ（ハッシュタグ含む）。短く、鋭く、しかし温かみを持って。
"""

        prompt_parts = [f"{self.system_prompt}\n\n{additional_instruction}\n\n[ユーザーの入力]\n{input_text}"]
        
        if self.current_image:
            prompt_parts.append(self.current_image)

        last_error = None
        for model_name in models_to_try:
            try:
                model = genai.GenerativeModel(model_name)
                response = model.generate_content(prompt_parts)
                
                self.log_interaction(mode, model_name, input_text, response.text, "Success")
                self.after(0, self.update_output, response.text)
                return 
                
            except Exception as e:
                last_error = e
                print(f"Model {model_name} failed: {e}")
                continue

        self.log_interaction(mode, "None", input_text, str(last_error), "Error")
        self.after(0, self.show_error, str(last_error))

    def update_output(self, text):
        self.output_box.insert("0.0", text)
        self.btn_generate.configure(state="normal", text="祈祷（回答生成）")

    def show_error(self, error_msg):
        tk.messagebox.showerror("儀式失敗", f"エラーが出たわい:\n{error_msg}")
        self.btn_generate.configure(state="normal", text="祈祷（回答生成）")

    def clear_input(self):
        self.input_box.delete("0.0", "end")
        self.current_image = None
        
        # 画像クリアの回避策: 空の画像で上書きする
        # image=None でエラーになる場合があるため
        empty_img = ctk.CTkImage(Image.new("RGBA", (1, 1), (0, 0, 0, 0)), size=(1, 1))
        self.lbl_preview.configure(image=empty_img, text="")

    def copy_to_clipboard_silent(self, text, btn_widget):
        if not text:
            return
        win32clipboard.OpenClipboard()
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardText(text, win32clipboard.CF_UNICODETEXT)
        win32clipboard.CloseClipboard()
        
        original_text = btn_widget.cget("text")
        btn_widget.configure(text="コピー済！")
        self.after(1000, lambda: btn_widget.configure(text=original_text))

    def copy_image_to_clipboard(self, silent=False):
        if self.current_image:
            output = io.BytesIO()
            self.current_image.convert("RGB").save(output, "BMP")
            data = output.getvalue()[14:]
            output.close()
            
            win32clipboard.OpenClipboard()
            win32clipboard.EmptyClipboard()
            win32clipboard.SetClipboardData(win32clipboard.CF_DIB, data)
            win32clipboard.CloseClipboard()
            
            if not silent:
                original_text = self.btn_copy_img.cget("text")
                self.btn_copy_img.configure(text="コピー済！")
                self.after(1000, lambda: self.btn_copy_img.configure(text=original_text))
        elif not silent:
            tk.messagebox.showwarning("警告", "画像がないわい。")

    def copy_input_to_clipboard(self):
        text = self.input_box.get("0.0", "end").strip()
        self.copy_to_clipboard_silent(text, self.btn_copy_input)

    def copy_output_to_clipboard(self):
        text = self.output_box.get("0.0", "end").strip()
        self.copy_to_clipboard_silent(text, self.btn_copy_output)

    def setup_context_menu(self, widget):
        """右クリックメニューを作成してウィジェットにバインドする"""
        menu = tk.Menu(self, tearoff=0)

        def cut_text():
            try:
                # 選択範囲のテキストを取得してクリップボードへ
                # CTkTextboxの内部ウィジェット(_textbox)を使用
                if hasattr(widget, "_textbox"):
                    text_widget = widget._textbox
                else:
                    text_widget = widget
                
                if text_widget.tag_ranges("sel"):
                    text = text_widget.get("sel.first", "sel.last")
                    self.clipboard_clear()
                    self.clipboard_append(text)
                    text_widget.delete("sel.first", "sel.last")
            except Exception:
                pass

        def copy_text():
            try:
                if hasattr(widget, "_textbox"):
                    text_widget = widget._textbox
                else:
                    text_widget = widget
                
                if text_widget.tag_ranges("sel"):
                    text = text_widget.get("sel.first", "sel.last")
                    self.clipboard_clear()
                    self.clipboard_append(text)
            except Exception:
                pass

        def paste_text():
            try:
                text = self.clipboard_get()
                widget.insert("insert", text)
            except Exception:
                pass

        def select_all():
            if hasattr(widget, "_textbox"):
                widget._textbox.tag_add("sel", "1.0", "end")
            return "break"

        menu.add_command(label="切り取り", command=cut_text)
        menu.add_command(label="コピー", command=copy_text)
        menu.add_command(label="貼り付け", command=paste_text)
        menu.add_separator()
        menu.add_command(label="全選択", command=select_all)

        def show_menu(event):
            widget.focus_set() # メニュー表示前にフォーカスを当てる
            menu.tk_popup(event.x_root, event.y_root)

        widget.bind("<Button-3>", show_menu)

if __name__ == "__main__":
    app = App()
    app.mainloop()
