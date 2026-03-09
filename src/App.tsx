import React, { useState, useRef } from "react";
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ChevronRight, 
  Download, 
  User, 
  BookOpen, 
  Target, 
  Layout, 
  Lightbulb,
  ArrowLeft,
  Star,
  Copy,
  ExternalLink,
  Archive,
  Trash2,
  Lock,
  X,
  Calendar
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { extractInfoFromText, evaluateInitiative, extractTextFromImage, type ExtractedInfo, type EvaluationResult } from "./services/geminiService";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } from "docx";
import { saveAs } from "file-saver";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Step = "upload" | "processing" | "results" | "archive" | "statistics";

interface ArchivedInitiative {
  id: string;
  timestamp: string;
  info: ExtractedInfo;
  evaluation: EvaluationResult;
  text: string;
}

export default function App() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState<string>("");
  const [info, setInfo] = useState<ExtractedInfo | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"info" | "text" | "eval">("info");
  const [archivedItems, setArchivedItems] = useState<ArchivedInitiative[]>(() => {
    const saved = localStorage.getItem("skkn_archive");
    return saved ? JSON.parse(saved) : [];
  });
  const [showPasswordModal, setShowPasswordModal] = useState<{show: boolean, itemId: string | null}>({show: false, itemId: null});
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  // Save archive to localStorage whenever it changes
  React.useEffect(() => {
    localStorage.setItem("skkn_archive", JSON.stringify(archivedItems));
  }, [archivedItems]);

  const PLAGIARISM_CHECK_URL = "https://justdone.com/vi/plagiarism-checker?utm_source=google&utm_medium=cpc&utm_campaign=23437567121&utm_content=190945227749&utm_adset_id=190945227749&utm_term=ki%E1%BB%83m%20tra%20%C4%91%E1%BA%A1o%20v%C4%83n%20mi%E1%BB%85n%20ph%C3%AD&utm_network=g&utm_matchtype=b&gad_source=1&gad_campaignid=23437567121&gbraid=0AAAAACl2HA2cOX9TUtnY5AC8CUN8fbupt&gclid=Cj0KCQiA2bTNBhDjARIsAK89wlGBwXzgxHhmfse2vNdwQTOd9fum39UhpDahtfOkkyxnWRJkMmaxt_IaAm1rEALw_wcB";

  const handleLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    window.open(PLAGIARISM_CHECK_URL, "_blank");
  };

  const handlePlagiarismCheck = () => {
    // Copy text to clipboard for easy pasting
    navigator.clipboard.writeText(extractedText).then(() => {
      window.open(PLAGIARISM_CHECK_URL, "_blank");
    }).catch(err => {
      console.error('Could not copy text: ', err);
      window.open(PLAGIARISM_CHECK_URL, "_blank");
    });
  };
  
  const resetApp = () => {
    setStep("upload");
    setFile(null);
    setExtractedText("");
    setInfo(null);
    setEvaluation(null);
    setError(null);
    setActiveTab("info");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Reset input value so the same file can be selected again
    e.target.value = "";

    // Client-side size check (Increased to 2GB as per user request for "unlimited")
    const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
    if (selectedFile.size > MAX_SIZE) {
      setError("Tệp quá lớn. Vui lòng tải tệp dưới 2GB.");
      return;
    }

    setFile(selectedFile);
    setError(null);
    setEvaluation(null);
    setInfo(null);
    setExtractedText("");
    setActiveTab("info");
    setStep("processing");

    try {
      let text = "";
      const isImage = selectedFile.type.startsWith("image/");

      if (isImage) {
        // Handle image OCR using Gemini
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const base64 = (reader.result as string).split(",")[1];
            resolve(base64);
          };
          reader.onerror = reject;
        });
        reader.readAsDataURL(selectedFile);
        const base64Data = await base64Promise;
        text = await extractTextFromImage(base64Data, selectedFile.type);
      } else {
        // Handle documents via server
        const formData = new FormData();
        formData.append("file", selectedFile);

        const response = await fetch("/api/extract-text", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errData = await response.json();
            throw new Error(errData.error || "Lỗi khi trích xuất văn bản");
          } else {
            const responseText = await response.text();
            if (response.status === 413 || responseText.includes("413") || responseText.includes("Too Large")) {
              throw new Error("Tệp quá lớn. Vui lòng thử nén tệp hoặc chia nhỏ tệp nếu dung lượng vượt quá giới hạn hạ tầng mạng.");
            }
            if (response.status === 504 || response.status === 502) {
              throw new Error("Máy chủ phản hồi quá lâu. Vui lòng thử lại với tệp nhỏ hơn hoặc kiểm tra kết nối mạng.");
            }
            console.error("Server error (non-JSON):", responseText);
            throw new Error(`Máy chủ gặp lỗi (${response.status}). Vui lòng thử lại hoặc liên hệ quản trị viên.`);
          }
        }

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const responseText = await response.text();
          console.error("Non-JSON response received:", responseText.substring(0, 500));
          throw new Error("Máy chủ phản hồi không đúng định dạng. Vui lòng thử lại hoặc liên hệ quản trị viên.");
        }

        const data = await response.json();
        text = data.text;
      }

      if (!text || text.trim().length < 20) {
        throw new Error("Văn bản trích xuất quá ngắn hoặc không có nội dung. Vui lòng kiểm tra lại tệp.");
      }
      setExtractedText(text);

      // Extract info using Gemini
      const extractedInfo = await extractInfoFromText(text);
      setInfo(extractedInfo);
      setStep("results");
      setActiveTab("info");
    } catch (err: any) {
      console.error("Upload error details:", err);
      setError(`Lỗi: ${err.message || "Không thể tải tệp lên. Vui lòng thử lại."}`);
      setStep("upload");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleEvaluate = async () => {
    if (!extractedText || !info) return;
    setIsEvaluating(true);
    setActiveTab("eval");
    try {
      const result = await evaluateInitiative(extractedText);
      setEvaluation(result);
      
      // Automatically archive the result
      const newItem: ArchivedInitiative = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString("vi-VN"),
        info: info,
        evaluation: result,
        text: extractedText
      };
      setArchivedItems(prev => [newItem, ...prev]);
    } catch (err: any) {
      setError("Lỗi khi đánh giá: " + err.message);
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleDeleteItem = (id: string) => {
    setShowPasswordModal({ show: true, itemId: id });
    setPasswordInput("");
    setPasswordError(false);
  };

  const confirmDelete = () => {
    if (passwordInput === "0987566304") {
      setArchivedItems(prev => prev.filter(item => item.id !== showPasswordModal.itemId));
      setShowPasswordModal({ show: false, itemId: null });
    } else {
      setPasswordError(true);
    }
  };

  const viewArchivedItem = (item: ArchivedInitiative) => {
    setInfo(item.info);
    setEvaluation(item.evaluation);
    setExtractedText(item.text);
    setStep("results");
    setActiveTab("eval");
  };

  const downloadPDF = async () => {
    if (!reportRef.current) return;
    
    // Using html2canvas for visual fidelity, but the user asked for editable.
    // The Word document will be the primary editable format.
    // For PDF, we'll keep the current approach as it's more reliable for complex layouts,
    // but we'll call it "Bản in PDF" to distinguish.
    const canvas = await html2canvas(reportRef.current, {
      scale: 2,
      useCORS: true,
      logging: false,
    });
    
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
    
    pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
    pdf.save(`Danh_gia_Sang_kien_${info?.author || "Giao_vien"}.pdf`);
  };

  const downloadWord = async () => {
    if (!info || !evaluation) return;
    await generateWordReport(info, evaluation);
  };

  const generateWordReport = async (info: ExtractedInfo, evaluation: EvaluationResult) => {
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              text: "BÁO CÁO ĐÁNH GIÁ SÁNG KIẾN KINH NGHIỆM",
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 },
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Tên đề tài: ", bold: true }),
                new TextRun(info.title),
              ],
              spacing: { after: 200 },
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Tác giả: ", bold: true }),
                new TextRun(info.author),
              ],
              spacing: { after: 200 },
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Lĩnh vực: ", bold: true }),
                new TextRun(info.field),
              ],
              spacing: { after: 400 },
            }),

            new Paragraph({
              text: "KẾT QUẢ ĐÁNH GIÁ CHI TIẾT",
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 400, after: 200 },
            }),

            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Tiêu chí", bold: true })] })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Điểm", bold: true })] })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Nhận xét", bold: true })] })] }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph("Tính mới & Sáng tạo")] }),
                    new TableCell({ children: [new Paragraph(evaluation.criteria.novelty.score.toString())] }),
                    new TableCell({ children: [new Paragraph(evaluation.criteria.novelty.comment)] }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph("Cơ sở lý luận & Thực tiễn")] }),
                    new TableCell({ children: [new Paragraph(evaluation.criteria.basis.score.toString())] }),
                    new TableCell({ children: [new Paragraph(evaluation.criteria.basis.comment)] }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph("Nội dung & Giải pháp")] }),
                    new TableCell({ children: [new Paragraph(evaluation.criteria.content.score.toString())] }),
                    new TableCell({ children: [new Paragraph(evaluation.criteria.content.comment)] }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph("Hiệu quả đạt được")] }),
                    new TableCell({ children: [new Paragraph(evaluation.criteria.effectiveness.score.toString())] }),
                    new TableCell({ children: [new Paragraph(evaluation.criteria.effectiveness.comment)] }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph("Khả năng áp dụng")] }),
                    new TableCell({ children: [new Paragraph(evaluation.criteria.applicability.score.toString())] }),
                    new TableCell({ children: [new Paragraph(evaluation.criteria.applicability.comment)] }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph("Hình thức trình bày")] }),
                    new TableCell({ children: [new Paragraph(evaluation.criteria.presentation.score.toString())] }),
                    new TableCell({ children: [new Paragraph(evaluation.criteria.presentation.comment)] }),
                  ],
                }),
              ],
            }),

            new Paragraph({
              children: [
                new TextRun({ text: "\nTỔNG ĐIỂM: ", bold: true, size: 28 }),
                new TextRun({ text: `${evaluation.totalScore}/100`, bold: true, size: 28, color: "FF1493" }),
              ],
              spacing: { before: 400 },
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "XẾP LOẠI: ", bold: true, size: 28 }),
                new TextRun({ text: evaluation.classification, bold: true, size: 28, color: "FF1493" }),
              ],
              spacing: { after: 400 },
            }),

            new Paragraph({
              text: "NHẬN XÉT CHUNG",
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 400, after: 200 },
            }),
            new Paragraph({
              text: evaluation.generalComment,
              spacing: { after: 400 },
            }),
          ],
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `Danh_gia_Sang_kien_${info.author}.docx`);
  };

  const downloadArchivedWord = async (item: ArchivedInitiative) => {
    await generateWordReport(item.info, item.evaluation);
  };

  return (
    <div className="min-h-screen text-slate-800 font-sans selection:bg-pink-100 relative">
      <input 
        ref={fileInputRef}
        type="file" 
        className="hidden" 
        accept="*" 
        onChange={handleFileUpload} 
      />
      {/* Page Background */}
      <div className="fixed inset-0 z-[-1]">
        <img 
          src="https://pdr.vn/wp-content/uploads/2021/04/hinh-nen-mam-non-dep-nhat.jpg" 
          alt="Page Background" 
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px]"></div>
      </div>

      {/* Header */}
      <header className="bg-white border-b border-pink-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-pink-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-pink-200">
              <Star className="w-6 h-6 fill-current" />
            </div>
            <h1 className="text-lg sm:text-xl font-black bg-gradient-to-r from-pink-600 to-pink-400 bg-clip-text text-transparent tracking-tight">
              TRƯỜNG MẦM NON HỒNG HÀ
            </h1>
          </div>
          
            <div className="flex items-center gap-4">
              {step !== "upload" && (
                <button 
                  onClick={resetApp}
                  className="flex items-center gap-2 text-slate-500 hover:text-pink-500 transition-colors text-sm font-medium"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Quay lại
                </button>
              )}
            </div>
          </div>
        </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {step === "upload" && (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-5xl mx-auto text-center"
            >
              <div className="mb-12">
                <h2 className="text-xl sm:text-3xl md:text-4xl font-black text-pink-600 mb-4 tracking-tighter uppercase whitespace-nowrap">
                  Hệ thống Đánh giá Sáng kiến Kinh nghiệm
                </h2>
                <p className="text-lg text-slate-500 whitespace-nowrap">
                  Hệ thống AI hỗ trợ giáo viên mầm non phân tích, chấm điểm và kiểm tra độ trùng lặp sáng kiến chuyên nghiệp, nhanh gọn và chính xác.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-pink-500 to-pink-300 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                  <div className="relative flex flex-col items-center justify-center w-full h-80 border-2 border-dashed border-pink-200 rounded-3xl bg-white hover:bg-pink-50/50 transition-all shadow-xl shadow-pink-100/20 p-6">
                    <div className="w-20 h-20 bg-pink-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-500 shadow-inner">
                      <Upload className="w-10 h-10 text-pink-500" />
                    </div>
                    <p className="mb-4 text-xl font-bold text-slate-800 text-center uppercase">
                      PHẦN MỀM CHẤM SKKN
                    </p>
                    <div className="w-full space-y-4">
                      <p className="text-sm text-slate-500 text-center px-2">
                        Hỗ trợ mọi định dạng tệp (Word, PDF, Ảnh, Text...). Dung lượng tối đa 2GB.
                      </p>
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full py-4 bg-pink-500 text-white rounded-xl font-bold hover:bg-pink-600 transition-all shadow-lg shadow-pink-200 active:scale-95 flex items-center justify-center gap-2"
                      >
                        <Upload className="w-5 h-5" />
                        Tải file lên ngay
                      </button>
                    </div>
                  </div>
                </div>

                <div className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-blue-300 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                  <div className="relative flex flex-col items-center justify-center w-full h-80 border-2 border-dashed border-blue-200 rounded-3xl bg-white hover:bg-blue-50/50 transition-all shadow-xl shadow-blue-100/20 p-6">
                    <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-500 shadow-inner">
                      <Lightbulb className="w-10 h-10 text-blue-500" />
                    </div>
                    <p className="mb-4 text-xl font-bold text-slate-800 text-center uppercase">
                      PHẦN MỀM CHECK ĐẠO VĂN
                    </p>
                    <div className="w-full space-y-4">
                      <p className="text-sm text-slate-500 text-center px-2">
                        Phát hiện nội dung trùng lặp từ nhiều nguồn trên internet.
                      </p>
                      <button 
                        onClick={() => window.open(PLAGIARISM_CHECK_URL, "_blank")}
                        className="w-full py-4 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-600 transition-all shadow-lg shadow-blue-200 active:scale-95 flex items-center justify-center gap-2"
                      >
                        <FileText className="w-5 h-5" />
                        Kiểm tra đạo văn ngay
                      </button>
                    </div>
                  </div>
                </div>

                <div className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-emerald-300 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                  <div className="relative flex flex-col items-center justify-center w-full h-80 border-2 border-dashed border-emerald-200 rounded-3xl bg-white hover:bg-emerald-50/50 transition-all shadow-xl shadow-emerald-100/20 p-6">
                    <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-500 shadow-inner">
                      <Archive className="w-10 h-10 text-emerald-500" />
                    </div>
                    <p className="mb-4 text-xl font-bold text-slate-800 text-center uppercase">
                      KHO LƯU TRỮ SKKN
                    </p>
                    <div className="w-full space-y-4">
                      <p className="text-sm text-slate-500 text-center px-2">
                        Xem lại các sáng kiến đã chấm điểm. Lưu trữ nhanh chóng và bảo mật.
                      </p>
                      <button 
                        onClick={() => setStep("archive")}
                        className="w-full py-4 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-200 active:scale-95 flex items-center justify-center gap-2"
                      >
                        <Archive className="w-5 h-5" />
                        Mở kho lưu trữ
                      </button>
                    </div>
                  </div>
                </div>

                <div className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-amber-500 to-amber-300 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                  <div className="relative flex flex-col items-center justify-center w-full h-80 border-2 border-dashed border-amber-200 rounded-3xl bg-white hover:bg-amber-50/50 transition-all shadow-xl shadow-amber-100/20 p-6">
                    <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-500 shadow-inner">
                      <Star className="w-10 h-10 text-amber-500" />
                    </div>
                    <p className="mb-4 text-xl font-bold text-slate-800 text-center uppercase">
                      THỐNG KÊ KẾT QUẢ
                    </p>
                    <div className="w-full space-y-4">
                      <p className="text-sm text-slate-500 text-center px-2">
                        Tổng hợp kết quả chấm điểm, tỉ lệ đạt và tải báo cáo tổng hợp.
                      </p>
                      <button 
                        onClick={() => setStep("statistics")}
                        className="w-full py-4 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-600 transition-all shadow-lg shadow-amber-200 active:scale-95 flex items-center justify-center gap-2"
                      >
                        <Star className="w-5 h-5" />
                        Xem thống kê
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="mt-6 p-4 bg-pink-50 border border-pink-100 rounded-2xl flex items-center gap-3 text-pink-600">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm font-medium">{error}</p>
                </div>
              )}

              <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-8">
                {[
                  { icon: CheckCircle2, title: "Nhanh chóng", desc: "Phân tích chỉ trong vài giây" },
                  { icon: FileText, title: "Chính xác", desc: "Dựa trên bộ tiêu chí chuẩn" },
                  { icon: Lightbulb, title: "Gợi ý", desc: "Nhận xét mang tính xây dựng" },
                ].map((item, i) => (
                  <div key={i} className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4">
                      <item.icon className="w-6 h-6 text-pink-400" />
                    </div>
                    <h3 className="font-bold text-slate-800 mb-1">{item.title}</h3>
                    <p className="text-sm text-slate-500">{item.desc}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {step === "statistics" && (
            <motion.div
              key="statistics"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-5xl mx-auto"
            >
              <div className="bg-white/80 backdrop-blur-xl rounded-[40px] shadow-2xl shadow-amber-200/20 border border-white p-8 md:p-12">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-3xl font-black text-slate-900 flex items-center gap-3">
                    <Star className="w-8 h-8 text-amber-500" />
                    Thống kê kết quả chấm SKKN
                  </h2>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={resetApp}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition-all text-sm"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Quay lại trang chủ
                    </button>
                    <button 
                      onClick={resetApp}
                      className="p-3 bg-slate-100 hover:bg-slate-200 rounded-2xl transition-colors"
                    >
                      <X className="w-6 h-6 text-slate-600" />
                    </button>
                  </div>
                </div>

                {archivedItems.length === 0 ? (
                  <div className="text-center py-20">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Star className="w-10 h-10 text-slate-300" />
                    </div>
                    <p className="text-slate-500 font-medium">Chưa có dữ liệu thống kê.</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <div className="bg-white border border-slate-100 rounded-[32px] overflow-hidden">
                      <div className="p-6 border-b border-slate-50 bg-slate-50/50">
                        <h3 className="font-bold text-slate-800">Danh sách kết quả chi tiết</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="text-slate-400 text-xs uppercase tracking-widest font-bold border-b border-slate-50">
                              <th className="px-6 py-4">Sáng kiến</th>
                              <th className="px-6 py-4">Tác giả</th>
                              <th className="px-6 py-4">Điểm</th>
                              <th className="px-6 py-4">Xếp loại</th>
                              <th className="px-6 py-4 text-right">Hành động</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {[...archivedItems]
                              .sort((a, b) => b.evaluation.totalScore - a.evaluation.totalScore)
                              .map((item) => (
                              <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-6 py-4">
                                  <p className="font-bold text-slate-800 line-clamp-1">{item.info.title}</p>
                                  <p className="text-xs text-slate-400">{item.timestamp}</p>
                                </td>
                                <td className="px-6 py-4 text-slate-600 font-medium">{item.info.author}</td>
                                <td className="px-6 py-4">
                                  <span className={cn(
                                    "px-3 py-1 rounded-full text-xs font-bold",
                                    item.evaluation.totalScore >= 85 ? "bg-emerald-50 text-emerald-600" :
                                    item.evaluation.totalScore >= 70 ? "bg-blue-50 text-blue-600" :
                                    "bg-amber-50 text-amber-600"
                                  )}>
                                    {item.evaluation.totalScore}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-slate-600 font-medium">{item.evaluation.classification}</td>
                                <td className="px-6 py-4 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <button 
                                      onClick={() => downloadArchivedWord(item)}
                                      className="p-2 text-blue-500 hover:bg-blue-50 rounded-xl transition-colors"
                                      title="Tải file Word kết quả"
                                    >
                                      <Download className="w-5 h-5" />
                                    </button>
                                    <button 
                                      onClick={() => handleDeleteItem(item.id)}
                                      className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                                      title="Xóa kết quả"
                                    >
                                      <Trash2 className="w-5 h-5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8 border-t border-slate-100">
                      <div className="bg-gradient-to-br from-blue-500 to-blue-400 p-8 rounded-[32px] text-white shadow-xl shadow-blue-100">
                        <p className="text-blue-100 font-bold uppercase tracking-widest text-xs mb-2">Số SKKN đã chấm</p>
                        <p className="text-5xl font-black tracking-tighter">{archivedItems.length}</p>
                      </div>
                      <div className="bg-gradient-to-br from-pink-500 to-pink-400 p-8 rounded-[32px] text-white shadow-xl shadow-pink-100">
                        <p className="text-pink-100 font-bold uppercase tracking-widest text-xs mb-2">Điểm trung bình</p>
                        <p className="text-5xl font-black tracking-tighter">
                          {(archivedItems.reduce((acc, item) => acc + item.evaluation.totalScore, 0) / archivedItems.length).toFixed(1)}
                        </p>
                      </div>
                      <div className="bg-gradient-to-br from-emerald-500 to-emerald-400 p-8 rounded-[32px] text-white shadow-xl shadow-emerald-100">
                        <p className="text-emerald-100 font-bold uppercase tracking-widest text-xs mb-2">Tỉ lệ Đạt/Không đạt</p>
                        <div className="flex items-baseline gap-2">
                          <p className="text-5xl font-black tracking-tighter">
                            {Math.round((archivedItems.filter(item => item.evaluation.totalScore >= 70).length / archivedItems.length) * 100)}%
                          </p>
                          <p className="text-xl font-bold opacity-60">Đạt</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
          {step === "archive" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-4xl mx-auto"
            >
              <div className="bg-white/80 backdrop-blur-xl rounded-[40px] shadow-2xl shadow-pink-200/20 border border-white p-8 md:p-12">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-3xl font-black text-slate-900 flex items-center gap-3">
                    <Archive className="w-8 h-8 text-pink-500" />
                    Kho lưu trữ SKKN
                  </h2>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={resetApp}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition-all text-sm"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Quay lại trang chủ
                    </button>
                    <button 
                      onClick={resetApp}
                      className="p-3 bg-slate-100 hover:bg-slate-200 rounded-2xl transition-colors"
                    >
                      <X className="w-6 h-6 text-slate-600" />
                    </button>
                  </div>
                </div>

                {archivedItems.length === 0 ? (
                  <div className="text-center py-20">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Archive className="w-10 h-10 text-slate-300" />
                    </div>
                    <p className="text-slate-500 font-medium">Chưa có sáng kiến nào được lưu trữ.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {archivedItems.map((item) => (
                      <div 
                        key={item.id}
                        className="group bg-white border border-slate-100 rounded-3xl p-6 hover:shadow-xl hover:shadow-pink-100/20 transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="px-3 py-1 bg-pink-50 text-pink-600 text-xs font-bold rounded-full flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {item.timestamp}
                            </span>
                            <span className="px-3 py-1 bg-blue-50 text-blue-600 text-xs font-bold rounded-full">
                              {item.evaluation.totalScore} điểm
                            </span>
                          </div>
                          <h3 className="font-bold text-slate-800 text-lg mb-1 line-clamp-1">{item.info.title}</h3>
                          <p className="text-slate-500 text-sm flex items-center gap-2">
                            <User className="w-4 h-4" />
                            {item.info.author} • {item.info.field}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 w-full md:w-auto">
                          <button 
                            onClick={() => viewArchivedItem(item)}
                            className="flex-1 md:flex-none px-6 py-3 bg-pink-500 text-white rounded-2xl font-bold text-sm hover:bg-pink-600 transition-all active:scale-95"
                          >
                            Xem lại
                          </button>
                          <button 
                            onClick={() => handleDeleteItem(item.id)}
                            className="p-3 bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-500 rounded-2xl transition-all active:scale-95"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {step === "processing" && (
            <motion.div 
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20"
            >
              <div className="relative">
                <div className="w-24 h-24 border-4 border-pink-100 border-t-pink-500 rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <FileText className="w-8 h-8 text-pink-500" />
                </div>
              </div>
              <h3 className="mt-8 text-2xl font-bold text-slate-800">Đang xử lý tài liệu...</h3>
              <p className="mt-2 text-slate-500">AI đang đọc và trích xuất thông tin từ sáng kiến của bạn.</p>
            </motion.div>
          )}

          {step === "results" && (
            <motion.div 
              key="results"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
              {/* Sidebar Tabs */}
              <div className="lg:col-span-3 space-y-2">
                <button 
                  onClick={() => setActiveTab("info")}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-medium text-left",
                    activeTab === "info" ? "bg-pink-500 text-white shadow-lg shadow-pink-200" : "bg-white text-slate-600 hover:bg-pink-50"
                  )}
                >
                  <User className="w-5 h-5" />
                  Thông tin chung
                </button>
                <button 
                  onClick={() => setActiveTab("text")}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-medium text-left",
                    activeTab === "text" ? "bg-pink-500 text-white shadow-lg shadow-pink-200" : "bg-white text-slate-600 hover:bg-pink-50"
                  )}
                >
                  <BookOpen className="w-5 h-5" />
                  Nội dung văn bản
                </button>
                <button 
                  onClick={() => {
                    if (!evaluation) handleEvaluate();
                    else setActiveTab("eval");
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-medium text-left",
                    activeTab === "eval" ? "bg-pink-500 text-white shadow-lg shadow-pink-200" : "bg-white text-slate-600 hover:bg-pink-50"
                  )}
                >
                  <Star className="w-5 h-5" />
                  Đánh giá AI
                </button>
                
                <div className="space-y-3 mt-8">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-pink-500 text-white shadow-lg shadow-pink-200 font-bold hover:bg-pink-600 transition-all active:scale-95 mb-4"
                  >
                    <Upload className="w-5 h-5" />
                    Tải tệp mới
                  </button>

                  {evaluation && (
                    <div className="space-y-3">
                      <button 
                        onClick={downloadWord}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200 font-medium hover:bg-blue-700 transition-colors"
                      >
                        <FileText className="w-5 h-5" />
                        Tải file Word (Chỉnh sửa được)
                      </button>
                      <button 
                        onClick={downloadPDF}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-pink-600 text-white shadow-lg shadow-pink-200 font-medium hover:bg-pink-700 transition-colors"
                      >
                        <Download className="w-5 h-5" />
                        Tải file PDF (Bản in)
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Main Content Area */}
              <div className="lg:col-span-9">
                <div className="bg-white rounded-3xl shadow-sm border border-pink-100 overflow-hidden min-h-[600px]">
                  <AnimatePresence mode="wait">
                    {activeTab === "info" && info && (
                      <motion.div 
                        key="info-tab"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="p-8"
                      >
                        <h3 className="text-2xl font-bold text-slate-900 mb-8 flex items-center gap-2">
                          <User className="w-6 h-6 text-pink-500" />
                          Thông tin trích xuất
                        </h3>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <InfoItem label="Tác giả" value={info.author} icon={User} />
                          <InfoItem label="Lĩnh vực" value={info.field} icon={Layout} />
                          <div className="md:col-span-2">
                            <InfoItem label="Tên đề tài" value={info.title} icon={FileText} highlight />
                          </div>
                          <InfoItem label="Mục tiêu" value={info.objectives} icon={Target} />
                          <InfoItem label="Đối tượng" value={info.target} icon={User} />
                          <div className="md:col-span-2">
                            <InfoItem label="Nội dung chính" value={info.mainContent} icon={BookOpen} />
                          </div>
                          <div className="md:col-span-2">
                            <InfoItem label="Kết quả dự kiến" value={info.expectedResults} icon={CheckCircle2} />
                          </div>
                        </div>
                        
                        {!evaluation && (
                          <div className="mt-12 flex justify-center">
                            <button 
                              onClick={handleEvaluate}
                              className="group relative px-8 py-4 bg-pink-500 text-white rounded-2xl font-bold text-lg shadow-xl shadow-pink-200 hover:bg-pink-600 transition-all flex items-center gap-3"
                            >
                              Bắt đầu đánh giá AI
                              <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </button>
                          </div>
                        )}
                      </motion.div>
                    )}

                    {activeTab === "text" && (
                      <motion.div 
                        key="text-tab"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="p-8"
                      >
                        <h3 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                          <BookOpen className="w-6 h-6 text-pink-500" />
                          Toàn văn bản sáng kiến
                        </h3>
                        <div className="bg-slate-50 rounded-2xl p-6 max-h-[700px] overflow-y-auto font-serif text-lg leading-relaxed text-slate-700 whitespace-pre-wrap border border-slate-100">
                          {extractedText}
                        </div>
                      </motion.div>
                    )}

                    {activeTab === "eval" && (
                      <motion.div 
                        key="eval-tab"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="p-8"
                      >
                        {isEvaluating ? (
                          <div className="flex flex-col items-center justify-center py-20">
                            <Loader2 className="w-12 h-12 text-pink-500 animate-spin mb-4" />
                            <h4 className="text-xl font-bold text-slate-800">AI đang chấm điểm...</h4>
                            <p className="text-slate-500">Quá trình này có thể mất 10-20 giây.</p>
                          </div>
                        ) : evaluation ? (
                          <div ref={reportRef} className="space-y-8">
                            <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-8 bg-gradient-to-br from-pink-600 to-pink-400 rounded-3xl text-white shadow-xl shadow-pink-200">
                              <div>
                                <p className="text-pink-100 font-bold uppercase tracking-widest text-xs mb-2">Tổng điểm sáng kiến</p>
                                <div className="flex items-baseline gap-2">
                                  <span className="text-7xl font-black tracking-tighter">{evaluation.totalScore}</span>
                                  <span className="text-2xl font-bold opacity-60">/ 100</span>
                                </div>
                              </div>
                              <div className="flex flex-col items-center md:items-end gap-4">
                                <div className="text-center md:text-right">
                                  <p className="text-pink-100 font-bold uppercase tracking-widest text-xs mb-2">Xếp loại</p>
                                  <div className="px-8 py-3 bg-white/20 backdrop-blur-xl rounded-2xl text-3xl font-black border border-white/30 shadow-lg">
                                    {evaluation.classification}
                                  </div>
                                </div>
                                <button 
                                  onClick={handlePlagiarismCheck}
                                  className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-sm font-bold transition-all"
                                  title="Copy văn bản và mở trang check đạo văn"
                                >
                                  <Copy className="w-4 h-4" />
                                  Check đạo văn ngay
                                  <ExternalLink className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <ScoreCard 
                                title="Tính mới & Sáng tạo" 
                                score={evaluation.criteria.novelty.score} 
                                max={20} 
                                comment={evaluation.criteria.novelty.comment} 
                              />
                              <ScoreCard 
                                title="Cơ sở lý luận & Thực tiễn" 
                                score={evaluation.criteria.basis.score} 
                                max={15} 
                                comment={evaluation.criteria.basis.comment} 
                              />
                              <ScoreCard 
                                title="Nội dung & Giải pháp" 
                                score={evaluation.criteria.content.score} 
                                max={25} 
                                comment={evaluation.criteria.content.comment} 
                              />
                              <ScoreCard 
                                title="Hiệu quả đạt được" 
                                score={evaluation.criteria.effectiveness.score} 
                                max={25} 
                                comment={evaluation.criteria.effectiveness.comment} 
                              />
                              <ScoreCard 
                                title="Khả năng áp dụng" 
                                score={evaluation.criteria.applicability.score} 
                                max={10} 
                                comment={evaluation.criteria.applicability.comment} 
                              />
                              <ScoreCard 
                                title="Hình thức trình bày" 
                                score={evaluation.criteria.presentation.score} 
                                max={5} 
                                comment={evaluation.criteria.presentation.comment} 
                              />
                            </div>

                            <div className="p-8 bg-slate-50 rounded-3xl border border-slate-100">
                              <h4 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                                <Lightbulb className="w-6 h-6 text-pink-500" />
                                Nhận xét chung & Gợi ý cải thiện
                              </h4>
                              <p className="text-slate-700 leading-relaxed italic">
                                "{evaluation.generalComment}"
                              </p>
                            </div>

                            <div className="flex flex-col sm:flex-row justify-center gap-4 pt-8">
                              <button
                                onClick={resetApp}
                                className="flex items-center justify-center gap-2 px-8 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all active:scale-95"
                              >
                                <ArrowLeft className="w-5 h-5" />
                                Quay lại trang chủ
                              </button>
                              <button
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center justify-center gap-2 px-8 py-4 bg-pink-500 text-white rounded-2xl font-bold hover:bg-pink-600 transition-all shadow-lg shadow-pink-200 active:scale-95"
                              >
                                <Upload className="w-5 h-5" />
                                Chấm sáng kiến mới
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Password Modal */}
      <AnimatePresence>
        {showPasswordModal.show && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPasswordModal({ show: false, itemId: null })}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-[32px] shadow-2xl p-8 w-full max-w-md"
            >
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-6">
                  <Lock className="w-8 h-8 text-red-500" />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 mb-2">Xác nhận xóa</h3>
                <p className="text-slate-500 mb-8">Vui lòng nhập mật khẩu để xóa sáng kiến này khỏi kho lưu trữ.</p>
                
                <div className="w-full space-y-4">
                  <input 
                    type="password"
                    placeholder="Nhập mật khẩu"
                    className={cn(
                      "w-full px-6 py-4 rounded-2xl border bg-slate-50 focus:outline-none focus:ring-2 transition-all text-center text-xl tracking-widest",
                      passwordError ? "border-red-300 focus:ring-red-400" : "border-slate-100 focus:ring-pink-400"
                    )}
                    value={passwordInput}
                    onChange={(e) => {
                      setPasswordInput(e.target.value);
                      setPasswordError(false);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && confirmDelete()}
                    autoFocus
                  />
                  {passwordError && (
                    <p className="text-red-500 text-sm font-medium">Mật khẩu không chính xác!</p>
                  )}
                  <div className="flex gap-3 pt-4">
                    <button 
                      onClick={() => setShowPasswordModal({ show: false, itemId: null })}
                      className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all"
                    >
                      Hủy
                    </button>
                    <button 
                      onClick={confirmDelete}
                      className="flex-1 py-4 bg-red-500 text-white rounded-2xl font-bold hover:bg-red-600 transition-all shadow-lg shadow-red-200"
                    >
                      Xác nhận xóa
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="w-full mt-20 relative overflow-hidden bg-transparent">
      {/* Full-width background illustration */}
      <div className="absolute inset-0 z-0 opacity-30">
        <img 
          src="https://pdr.vn/wp-content/uploads/2021/04/hinh-nen-mam-non-dep-nhat.jpg" 
          alt="Preschool Illustration" 
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-white"></div>
      </div>
      
      <div className="max-w-6xl mx-auto px-4 py-16 text-center relative z-10">
        <div className="h-px bg-gradient-to-r from-transparent via-pink-200 to-transparent mb-12"></div>
        
        <div className="bg-white/80 backdrop-blur-md inline-block p-10 rounded-[40px] border border-white shadow-2xl shadow-pink-200/50">
          <p className="text-slate-600 font-black text-2xl mb-4 tracking-tight">TRƯỜNG MẦM NON HỒNG HÀ</p>
          <div className="text-pink-600 font-bold mb-6 space-y-2 text-lg">
            <p className="flex items-center justify-center gap-2">
              <span className="w-2 h-2 bg-pink-400 rounded-full"></span>
              Họ và tên: Châu Thị Phượng
            </p>
            <p className="flex items-center justify-center gap-2">
              <span className="w-2 h-2 bg-pink-400 rounded-full"></span>
              Số điện thoại: 0963238968
            </p>
            <p className="flex items-center justify-center gap-2">
              <span className="w-2 h-2 bg-pink-400 rounded-full"></span>
              Gmail: hoaphuongmn.dp@gmail.com
            </p>
          </div>
          <p className="text-pink-400 text-sm font-bold italic tracking-wide">
            © 2026 Hệ thống Đánh giá Sáng kiến Kinh nghiệm. Hỗ trợ bởi AI.
          </p>
        </div>
      </div>
    </footer>
  );
}

function InfoItem({ label, value, icon: Icon, highlight = false }: { label: string; value: string; icon: any; highlight?: boolean }) {
  return (
    <div className={cn(
      "p-5 rounded-2xl border transition-all",
      highlight ? "bg-pink-50/50 border-pink-100" : "bg-white border-slate-100"
    )}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-pink-500" />
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn(
        "text-slate-800 leading-snug",
        highlight ? "text-lg font-bold" : "text-base font-medium"
      )}>
        {value || "Không tìm thấy thông tin"}
      </p>
    </div>
  );
}

function ScoreCard({ title, score, max, comment }: { title: string; score: number; max: number; comment: string }) {
  const percentage = (score / max) * 100;
  
  return (
    <div className="p-6 bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <h5 className="font-bold text-slate-800 leading-tight pr-4">{title}</h5>
        <div className="flex flex-col items-end">
          <span className="text-2xl font-black text-pink-500">{score}</span>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">/ {max} điểm</span>
        </div>
      </div>
      
      <div className="w-full h-2 bg-slate-100 rounded-full mb-4 overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 1, delay: 0.2 }}
          className="h-full bg-gradient-to-r from-pink-500 to-pink-400 rounded-full"
        />
      </div>
      
      <p className="text-sm text-slate-600 leading-relaxed">
        {comment}
      </p>
    </div>
  );
}
