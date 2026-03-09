import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface EvaluationResult {
  criteria: {
    novelty: { score: number; comment: string };
    basis: { score: number; comment: string };
    content: { score: number; comment: string };
    effectiveness: { score: number; comment: string };
    applicability: { score: number; comment: string };
    presentation: { score: number; comment: string };
  };
  totalScore: number;
  classification: string;
  generalComment: string;
}

export interface ExtractedInfo {
  author: string;
  title: string;
  field: string;
  objectives: string;
  target: string;
  mainContent: string;
  expectedResults: string;
}

export async function extractInfoFromText(text: string): Promise<ExtractedInfo> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Bạn là một chuyên gia giáo dục mầm non. Hãy trích xuất các thông tin chính từ văn bản sáng kiến kinh nghiệm sau đây.
    Văn bản:
    ${text.substring(0, 100000)} // Increased to 100k characters
    
    Yêu cầu trả về định dạng JSON với các trường:
    - author: Họ và tên tác giả
    - title: Tên đề tài sáng kiến kinh nghiệm
    - field: Lĩnh vực áp dụng
    - objectives: Mục tiêu đề tài
    - target: Đối tượng áp dụng
    - mainContent: Tóm tắt nội dung chính
    - expectedResults: Dự kiến kết quả đạt được`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          author: { type: Type.STRING },
          title: { type: Type.STRING },
          field: { type: Type.STRING },
          objectives: { type: Type.STRING },
          target: { type: Type.STRING },
          mainContent: { type: Type.STRING },
          expectedResults: { type: Type.STRING },
        },
        required: ["author", "title", "field", "objectives", "target", "mainContent", "expectedResults"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
}

export async function extractTextFromImage(base64Data: string, mimeType: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType,
        },
      },
      {
        text: "Hãy trích xuất toàn bộ văn bản có trong hình ảnh này. Chỉ trả về nội dung văn bản, không thêm bất kỳ lời giải thích nào khác.",
      },
    ],
  });

  return response.text || "";
}

export async function evaluateInitiative(text: string): Promise<EvaluationResult> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Bạn là một giám khảo chấm điểm sáng kiến kinh nghiệm cấp học mầm non. Hãy đánh giá văn bản sau đây một cách khách quan, chuyên nghiệp và mang tính xây dựng sư phạm.
    
    Văn bản:
    ${text.substring(0, 200000)} // Increased to 200k characters
    
    Bộ tiêu chí chấm điểm (Tổng 100 điểm):
    1. Tính mới và sáng tạo (20 điểm): Ý tưởng mới, giải pháp cải tiến, không trùng lặp.
    2. Cơ sở lý luận và thực tiễn (15 điểm): Căn cứ khoa học, phân tích thực trạng, số liệu minh chứng.
    3. Nội dung và giải pháp thực hiện (25 điểm): Cụ thể, khả thi, quy trình rõ ràng, có minh chứng.
    4. Hiệu quả đạt được (25 điểm): So sánh trước-sau, số liệu kiểm chứng, tác động thực tế.
    5. Khả năng áp dụng và nhân rộng (10 điểm): Có thể áp dụng cho tổ/khối/trường khác.
    6. Hình thức trình bày (5 điểm): Đúng cấu trúc, khoa học, trích dẫn đúng.
    
    Xếp loại:
    - 90-100: Xuất sắc
    - 75-89: Tốt
    - 60-74: Khá
    - 50-59: Đạt yêu cầu
    - Dưới 50: Không đạt
    
    Yêu cầu trả về định dạng JSON. Nhận xét phải bằng tiếng Việt, văn phong sư phạm mầm non.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          criteria: {
            type: Type.OBJECT,
            properties: {
              novelty: {
                type: Type.OBJECT,
                properties: { score: { type: Type.NUMBER }, comment: { type: Type.STRING } }
              },
              basis: {
                type: Type.OBJECT,
                properties: { score: { type: Type.NUMBER }, comment: { type: Type.STRING } }
              },
              content: {
                type: Type.OBJECT,
                properties: { score: { type: Type.NUMBER }, comment: { type: Type.STRING } }
              },
              effectiveness: {
                type: Type.OBJECT,
                properties: { score: { type: Type.NUMBER }, comment: { type: Type.STRING } }
              },
              applicability: {
                type: Type.OBJECT,
                properties: { score: { type: Type.NUMBER }, comment: { type: Type.STRING } }
              },
              presentation: {
                type: Type.OBJECT,
                properties: { score: { type: Type.NUMBER }, comment: { type: Type.STRING } }
              },
            }
          },
          totalScore: { type: Type.NUMBER },
          classification: { type: Type.STRING },
          generalComment: { type: Type.STRING },
        }
      },
    },
  });

  return JSON.parse(response.text || "{}");
}
