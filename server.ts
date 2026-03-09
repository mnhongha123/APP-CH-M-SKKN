import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import mammoth from "mammoth";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");
const WordExtractor = require("word-extractor");
import path from "path";
import fs from "fs";

const upload = multer({ 
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir);
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname);
    }
  }),
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024 // 2GB limit
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '2gb' }));
  app.use(express.urlencoded({ limit: '2gb', extended: true }));

  // API Route for file upload and text extraction
  app.post("/api/extract-text", (req, res, next) => {
    console.log("Incoming request to /api/extract-text");
    upload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        console.error("Multer error:", err);
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "Tệp quá lớn. Vui lòng tải tệp dưới 500MB." });
        }
        return res.status(400).json({ error: "Lỗi tải tệp: " + err.message });
      } else if (err) {
        console.error("Unknown upload error:", err);
        return res.status(500).json({ error: "Lỗi máy chủ khi tải tệp: " + err.message });
      }
      next();
    });
  }, async (req, res, next) => {
    try {
      console.log("Multer finished, processing file...");
      if (!req.file) {
        console.warn("No file uploaded in request");
        return res.status(400).json({ error: "Không tìm thấy tệp trong yêu cầu tải lên." });
      }

      const filePath = req.file.path;
      const buffer = fs.readFileSync(filePath);
      
      if (!buffer || buffer.length === 0) {
        console.warn("Uploaded file is empty");
        // Cleanup
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(400).json({ error: "Tệp tải lên trống (0 bytes). Vui lòng kiểm tra lại tệp." });
      }

      const originalName = req.file.originalname;
      const extension = path.extname(originalName).toLowerCase();
      console.log(`Processing file: ${originalName} (${extension}), size: ${buffer.length} bytes`);

      let text = "";

      if (extension === ".docx") {
        console.log(`Extracting .docx text from ${originalName}...`);
        try {
          const result = await mammoth.extractRawText({ buffer });
          text = result.value;
          console.log(`Mammoth extraction successful, length: ${text?.length}`);
          if (!text || text.trim().length === 0) {
            throw new Error("Không tìm thấy văn bản trong tệp .docx này.");
          }
        } catch (err: any) {
          console.error(`Mammoth error for ${originalName}:`, err);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          return res.status(422).json({ error: "Không thể đọc tệp .docx. Có thể tệp bị lỗi hoặc không đúng định dạng Word hiện đại." });
        }
      } else if (extension === ".doc") {
        console.log(`Extracting .doc text from ${originalName}...`);
        try {
          // Handle potential ESM/CJS interop issues with word-extractor
          const WordExtractorClass = typeof WordExtractor === 'function' ? WordExtractor : WordExtractor.default;
          if (typeof WordExtractorClass !== 'function') {
            throw new Error("Word extractor initialization failed: WordExtractor is not a constructor");
          }
          
          const extractor = new WordExtractorClass();
          const doc = await extractor.extract(buffer);
          text = doc.getBody();
          console.log(`WordExtractor extraction successful, length: ${text?.length}`);
          if (!text || text.trim().length === 0) {
            throw new Error("Không tìm thấy văn bản trong tệp .doc này.");
          }
        } catch (err: any) {
          console.error(`WordExtractor error for ${originalName}:`, err);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          return res.status(422).json({ error: `Không thể đọc tệp .doc (${err.message}). Vui lòng thử lưu tệp thành .docx và tải lên lại.` });
        }
      } else if (extension === ".pdf") {
        console.log(`Extracting .pdf text from ${originalName}...`);
        try {
          // Handle potential ESM/CJS interop issues with pdf-parse
          const pdfParser = typeof pdf === 'function' ? pdf : pdf.default;
          if (typeof pdfParser !== 'function') {
            throw new Error("PDF parser initialization failed: pdf-parse is not a function");
          }
          
          const data = await pdfParser(buffer);
          text = data.text;
          console.log(`PDF-parse extraction successful, length: ${text?.length}`);
          if (!text || text.trim().length === 0) {
            throw new Error("Không tìm thấy văn bản trong tệp PDF này.");
          }
        } catch (err: any) {
          console.error(`PDF-parse error for ${originalName}:`, err);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          return res.status(422).json({ error: `Không thể đọc tệp PDF (${err.message}). Có thể tệp được bảo mật hoặc chỉ chứa hình ảnh (không có văn bản).` });
        }
      } else if (extension === ".txt") {
        console.log("Extracting .txt text...");
        text = buffer.toString("utf-8");
      } else {
        console.log(`Attempting to read unknown extension ${extension} as UTF-8 text...`);
        text = buffer.toString("utf-8");
        // Basic binary check
        if (text.includes('\0')) {
          console.warn(`File ${originalName} appears to be binary and unsupported.`);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          return res.status(400).json({ error: `Định dạng tệp ${extension} không được hỗ trợ hoặc là tệp nhị phân không thể đọc được.` });
        }
      }

      // Cleanup temp file
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      console.log(`Extraction successful. Text length: ${text.length}`);
      res.setHeader('Content-Type', 'application/json');
      res.json({ text, fileName: originalName });
    } catch (error: any) {
      console.error("Extraction error details:", error);
      // Cleanup on error
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ error: "Lỗi hệ thống khi trích xuất văn bản: " + error.message });
    }
  });

  // API 404 handler - prevent falling through to Vite/Static HTML for API calls
  app.use("/api/*", (req, res) => {
    res.status(404).json({ error: `API endpoint ${req.originalUrl} không tồn tại.` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.resolve("dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  }

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global error:", err);
    res.status(err.status || 500).json({ 
      error: err.message || "Internal Server Error",
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
