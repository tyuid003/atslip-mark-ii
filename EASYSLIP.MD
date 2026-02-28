Getting Started
The EasySlip Developer API allows developers to verify bank and truemoney wallet slip information. This guide provides an overview of how to interact with the API, including authentication methods and example requests

EasySlip Developer API คือเครื่องมือที่ช่วยให้นักพัฒนาสามารถตรวจสอบสลิปโอนเงินจาก ธนาคาร และ Truemoney Wallet ได้อย่างง่ายดาย และแม่นยำ คู่มือนี้จะช่วยให้คุณเข้าใจวิธีการใช้งาน API โดยมีข้อมูลสำคัญดังนี้

การยืนยันตัวตน (Authentication):
วิธีการใช้ Access Token เพื่อเข้าถึงระบบ API

ตัวอย่างการใช้งาน (Example Requests):
ตัวอย่างคำขอที่ใช้ในการตรวจสอบสลิปธนาคารและ Wallet

คู่มือนี้จะช่วยให้คุณเชื่อมต่อ API ของ EasySlip เข้ากับระบบหรือแอปพลิเคชันของคุณได้สะดวกยิ่งขึ้น หากมีคำถามหรือต้องการความช่วยเหลือเพิ่มเติม สามารถติดต่อทีมสนับสนุนของ EasySlip ได้เลย!

Base URL
นี่คือ URL หลักที่ใช้สำหรับการเรียกใช้งาน API

https://developer.easyslip.com/api/v1
Authentication
All requests must include an Authorization header with a valid Bearer token.

ทุกคำขอที่ส่งไปยัง API ต้องมีการยืนยันตัวตนโดยใช้ Authorization Header ที่ประกอบด้วย Bearer Token ที่ถูกต้อง ดังตัวอย่างด้านล่าง

Authorization: Bearer YOUR_ACCESS_TOKEN
คำอธิบายเพิ่มเติม

Base URL: ใช้เป็นจุดเริ่มต้นสำหรับ Endpoint ทั้งหมดใน EasySlip API
Bearer Token: คือรหัสที่ใช้สำหรับยืนยันตัวตนและสิทธิ์การเข้าถึง API ซึ่งสามารถรับได้หลังจากที่ผู้ใช้งานลงทะเบียนและเปิดแพ็กเกจเพื่อใช้งาน API

Me (ข้อมูลเกี่ยวกับแอปพลิเคชัน)
Get application informations

คำอธิบาย:
Endpoint นี้ใช้สำหรับดึงข้อมูลเกี่ยวกับแอปพลิเคชันที่คุณกำลังใช้งาน เช่น:

ชื่อแอปพลิเคชันที่เชื่อมต่อ
จำนวนโควต้าที่ใช้งานไปแล้ว
โควต้าสูงสุดที่สามารถใช้งานได้
โควต้าที่เหลืออยู่ในปัจจุบัน
วันที่และเวลาที่โควต้าจะหมดอายุ
เครดิตที่เหลืออยู่ในระบบสำหรับการทำงานต่าง ๆ
URL: /me
Method: GET
Headers:
Authorization: Bearer YOUR_ACCESS_TOKEN
(แทนที่ YOUR_ACCESS_TOKEN ด้วยโทเค็นจริงที่คุณได้รับหลังจากซื้อแพ็กเกจ)
Request Example (ตัวอย่างคำขอ)

curl --location 'https://developer.easyslip.com/api/v1/me' \
--header 'Authorization: Bearer YOUR_ACCESS_TOKEN'
Response Type (รูปแบบข้อมูลตอบกลับ)

type Data = {
    status: number
    data: {
        application: string
        usedQuota: number
        maxQuota: number
        remainingQuota: number
        expiredAt: string
        currentCredit: number
    }
}
Response Example (ตัวอย่างข้อมูลตอบกลับ)
Success (HTTP 200)

{
  "status": 200,
  "data": {
    "application": "EasySlip Developer",
    "usedQuota": 16,
    "maxQuota": 35000,
    "remainingQuota": 34984,
    "expiredAt": "2024-02-22T18:47:34+07:00",
    "currentCredit": 1000
  }
}
คำอธิบาย:

status: สถานะการตอบกลับ (200 หมายถึงสำเร็จ)

data: ข้อมูลเกี่ยวกับแอปพลิเคชันและโควต้าของคุณ:
application: ชื่อของแอปพลิเคชัน
usedQuota: จำนวนโควต้าที่คุณใช้งานไปแล้ว
maxQuota: โควต้าทั้งหมดที่ได้รับ
remainingQuota: โควต้าที่เหลืออยู่
expiredAt: วันหมดอายุของโควต้าปัจจุบัน
currentCredit: เครดิตที่เหลือในระบบ
ตัวอย่างกรณีผิดพลาด (Error Responses)
Error (HTTP 401)
unauthorized

{
  "status": 401,
  "message": "unauthorized"
}
สาเหตุ

ไม่มีการใส่ Access Token หรือ Token ไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบว่าได้ใส่ Authorization: Bearer YOUR_ACCESS_TOKEN ในคำขอหรือไม่
ตรวจสอบว่า Access Token ยังไม่หมดอายุ
Error (HTTP 403)
access_denied

{
  "status": 403,
  "message": "access_denied"
}
สาเหตุ

บัญชีหรือ Access Token ไม่มีสิทธิ์เข้าถึงทรัพยากรนี้
ฟีเจอร์นี้อาจสงวนไว้สำหรับผู้ใช้ระดับสูง หรือการตั้งค่าผิดพลาด
วิธีแก้ไข

ตรวจสอบสิทธิ์ของบัญชีและ Access Token
ตรวจสอบ URL และพารามิเตอร์ในคำขอ
หากยังพบปัญหา ติดต่อฝ่ายสนับสนุน EasySlip
Error (HTTP 500)
server_error

{
  "status": 500,
  "message": "server_error"
}
สาเหตุ

เกิดปัญหาภายในเซิร์ฟเวอร์ของ EasySlip
วิธีแก้ไข

ลองเรียก API ใหม่อีกครั้ง
หากยังมีปัญหา ติดต่อฝ่ายสนับสนุนของ EasySlip

Verify Bank Slip By Payload
Send a qr code payload for verification
คำอธิบาย: Endpoint นี้ใช้สำหรับตรวจสอบข้อมูลในสลิปธนาคารโดยการส่ง Payload

URL: /verify
Method: GET
Headers:
Authorization: Bearer YOUR_ACCESS_TOKEN
(แทนที่ YOUR_ACCESS_TOKEN ด้วยโทเค็นจริงที่คุณได้รับหลังจากซื้อแพ็กเกจ)
Query Parameters:
payload (string, required): Data read from qr code
checkDuplicate (boolean, optional): Check duplicate
Request Example (ตัวอย่างคำขอ)

curl --location 'https://developer.easyslip.com/api/v1/verify?payload=PAYLOAD' \
--header 'Authorization: Bearer YOUR_ACCESS_TOKEN'
Response Type (รูปแบบข้อมูลตอบกลับ)

type Data = {
    status: number
    data: {
        payload: string
        transRef: string
        date: string
        countryCode: string
        amount: {
            amount: number
            local: {
                amount?: number
                currency?: string
            }
        }
        fee?: number
        ref1?: string
        ref2?: string
        ref3?: string
        sender: {
            bank: {
                id?: string
                name?: string
                short?: string
            }
            account: {
                name: {
                    th?: string
                    en?: string
                }
                bank?: {
                    type: 'BANKAC' | 'TOKEN' | 'DUMMY'
                    account: string
                }
                proxy?: {
                    type: 'NATID' | 'MSISDN' | 'EWALLETID' | 'EMAIL' | 'BILLERID'
                    account: string
                }
            }
        }
        receiver: {
            bank: {
                id: string
                name?: string
                short?: string
            }
            account: {
                name: {
                    th?: string
                    en?: string
                }
                bank?: {
                    type: 'BANKAC' | 'TOKEN' | 'DUMMY'
                    account: string
                }
                proxy?: {
                    type: 'NATID' | 'MSISDN' | 'EWALLETID' | 'EMAIL' | 'BILLERID'
                    account: string
                }
            }
            merchantId?: string
        }
    }
}
Response Example (ตัวอย่างข้อมูลตอบกลับ)
Success (HTTP 200)

{
  "status": 200,
  "data": {
    "payload": "00000000000000000000000000000000000000000000000000000000000",
    "transRef": "68370160657749I376388B35",
    "date": "2023-01-01T00:00:00+07:00",
    "countryCode": "TH",
    "amount": {
      "amount": 1000,
      "local": {
        "amount": 0,
        "currency": ""
      }
    },
    "fee": 0,
    "ref1": "",
    "ref2": "",
    "ref3": "",
    "sender": {
      "bank": {
        "id": "001",
        "name": "กสิกรไทย",
        "short": "KBANK"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป",
          "en": "MR. EASY SLIP"
        },
        "bank": {
          "type": "BANKAC",
          "account": "1234xxxx5678"
        }
      }
    },
    "receiver": {
      "bank": {
        "id": "030",
        "name": "ธนาคารออมสิน",
        "short": "GSB"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป"
        },
        "bank": {
          "type": "BANKAC",
          "account": "12xxxx3456"
        },
        "proxy": {
          "type": "EWALLETID",
          "account": "123xxxxxxxx4567"
        }
      }
    }
  }
}
Error (HTTP 400)
invalid_payload

{
  "status": 400,
  "message": "invalid_payload"
}
สาเหตุ

Payload ที่ส่งมาไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบรูปแบบของ Payload และส่งใหม่
invalid_check_duplicate

{
  "status": 400,
  "message": "invalid_check_duplicate"
}
สาเหตุ

checkDuplicate ที่ส่งมาไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบรูปแบบของ checkDuplicate และส่งใหม่
duplicate_slip

{
  "status": 400,
  "message": "duplicate_slip",
  "data": {
    "payload": "00000000000000000000000000000000000000000000000000000000000",
    "transRef": "68370160657749I376388B35",
    "date": "2023-01-01T00:00:00+07:00",
    "countryCode": "TH",
    "amount": {
      "amount": 1000,
      "local": {
        "amount": 0,
        "currency": ""
      }
    },
    "fee": 0,
    "ref1": "",
    "ref2": "",
    "ref3": "",
    "sender": {
      "bank": {
        "id": "001",
        "name": "กสิกรไทย",
        "short": "KBANK"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป",
          "en": "MR. EASY SLIP"
        },
        "bank": {
          "type": "BANKAC",
          "account": "1234xxxx5678"
        }
      }
    },
    "receiver": {
      "bank": {
        "id": "030",
        "name": "ธนาคารออมสิน",
        "short": "GSB"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป"
        },
        "bank": {
          "type": "BANKAC",
          "account": "12xxxx3456"
        },
        "proxy": {
          "type": "EWALLETID",
          "account": "123xxxxxxxx4567"
        }
      }
    }
  }
}
Error (HTTP 401)
unauthorized

{
  "status": 401,
  "message": "unauthorized"
}
สาเหตุ

Access Token ไม่ถูกต้องหรือไม่ได้ใส่
วิธีแก้ไข

ตรวจสอบใน Header และใส่ Access Token ให้ถูกต้อง
Error (HTTP 403)
access_denied

{
  "status": 403,
  "message": "access_denied"
}
สาเหตุ

บัญชีของคุณไม่มีสิทธิ์ใช้งาน API นี้
วิธีแก้ไข

ตรวจสอบสิทธิ์การใช้งานกับทีมสนับสนุน
account_not_verified

{
  "status": 403,
  "message": "account_not_verified"
}
สาเหตุ

บัญชีผู้ใช้ไม่ได้ทำการยืนยัน KYC
วิธีแก้ไข

ติดต่อทีมสนับสนุน
application_expired

{
  "status": 403,
  "message": "application_expired"
}
สาเหตุ

ระยะเวลาการใช้งานหรือการสมัครสมาชิกของแอปพลิเคชันหมดอายุ
วิธีแก้ไข

ตรวจสอบสถานะของแอปพลิเคชันเข้าสู่ระบบในพอร์ทัล EasySlip และตรวจสอบว่าสถานะของแอปพลิเคชันหมดอายุหรือไม่
ดำเนินการต่ออายุการใช้งานหรือสมัครแพ็กเกจใหม่ให้เหมาะสมกับการใช้งาน
ติดต่อฝ่ายสนับสนุน EasySlip หากแอปพลิเคชันยังอยู่ในช่วงเวลาที่ควรใช้งานได้ แต่พบปัญหา ให้ติดต่อฝ่ายสนับสนุนเพื่อตรวจสอบและแก้ไขสถานะ
application_deactivated

{
  "status": 403,
  "message": "application_deactivated"
}
สาเหตุ

แอปพลิเคชันถูกปิดใช้งานโดยเจ้าของบัญชี หรือทีมสนับสนุนของ EasySlip
มีการละเมิดข้อกำหนดและเงื่อนไขการใช้งาน ทำให้ระบบปิดใช้งานแอปพลิเคชันโดยอัตโนมัติ
วิธีแก้ไข

ตรวจสอบสถานะของแอปพลิเคชันในระบบเข้าสู่ระบบในพอร์ทัล EasySlip และตรวจสอบว่าแอปพลิเคชันถูกปิดใช้งานหรือไม่หากคุณเป็นเจ้าของบัญชี ลองเปิดใช้งานแอปพลิเคชันใหม่ผ่านเมนูจัดการบัญชี
ติดต่อฝ่ายสนับสนุน EasySlip หากแอปพลิเคชันถูกปิดใช้งานโดยไม่มีการแจ้งล่วงหน้า ให้ติดต่อทีมสนับสนุนเพื่อขอข้อมูลเพิ่มเติม
quota_exceeded

{
  "status": 403,
  "message": "quota_exceeded"
}
สาเหตุ

คุณได้ใช้งาน API จนครบจำนวนครั้งที่โควต้าของบัญชีหรือแพ็กเกจกำหนด
ไม่มีการเติมโควต้าหรืออัปเกรดแพ็กเกจเพื่อเพิ่มจำนวนครั้งที่สามารถใช้งานได้
วิธีแก้ไข

ตรวจสอบสถานะโควต้าปัจจุบันเข้าสู่ระบบในพอร์ทัล EasySlip เพื่อดูจำนวนโควต้าที่เหลือหรือที่ใช้งานไปแล้ว
เพิ่มหรือต่ออายุโควต้าดำเนินการซื้อแพ็กเกจเพิ่มเติมหรืออัปเกรดบัญชีเพื่อเพิ่มโควต้าการใช้งาน
ติดต่อฝ่ายสนับสนุน EasySlip หากคุณเชื่อว่าข้อผิดพลาดเกิดจากระบบ หรือโควต้าควรมีเหลืออยู่ ให้ติดต่อฝ่ายสนับสนุนเพื่อตรวจสอบ
Error (HTTP 404)
slip_not_found

{
  "status": 404,
  "message": "slip_not_found"
}
สาเหตุ

ข้อมูลสลิปที่ส่งมาไม่ถูกต้องหรือไม่ตรงกับฐานข้อมูล
สลิปที่พยายามตรวจสอบไม่มีอยู่ในระบบ (อาจเกิดจากสลิปปลอม หรือข้อมูลที่ผิดพลาดจากธนาคารผุ้ออกสลิป)
วิธีแก้ไข

ตรวจสอบข้อมูลที่ส่งมายืนยันว่าข้อมูล Payload, เลขอ้างอิง, หรือรายละเอียดสลิปถูกต้องครบถ้วนตรวจสอบรูปแบบของข้อมูลตามที่ระบบกำหนด
ติดต่อฝ่ายสนับสนุน EasySlip หากมั่นใจว่าข้อมูลที่ส่งถูกต้อง แต่ยังเกิดปัญหา ให้ติดต่อทีมสนับสนุนเพื่อขอคำแนะนำเพิ่มเติม
Error (HTTP 500)
server_error

{
  "status": 500,
  "message": "server_error"
}
สาเหตุ

มีข้อผิดพลาดภายในระบบเซิร์ฟเวอร์ของ Easyslip
ปัญหาทางเทคนิค เช่น ระบบล่ม ฐานข้อมูลขัดข้อง หรือโค้ดที่ทำงานไม่ถูกต้อง
การสื่อสารระหว่างเซิร์ฟเวอร์และบริการที่เกี่ยวข้องล้มเหลว
วิธีแก้ไข

ลองทำคำขอใหม่ในภายหลังอาจเป็นปัญหาชั่วคราวของเซิร์ฟเวอร์ ให้รอและลองเรียกใช้ API อีกครั้ง
ตรวจสอบคำขอยืนยันว่าคำขอที่คุณส่งถูกต้องตามเอกสาร API เช่น รูปแบบของ Payload หรือ Headers
ติดต่อฝ่ายสนับสนุน EasySlip หากปัญหายังคงอยู่ ให้แจ้งทีมสนับสนุน พร้อมรายละเอียดคำขอ เช่น Endpoint, Request Body และเวลาที่ส่งคำขอ
api_server_error

{
  "status": 500,
  "message": "api_server_error"
}
สาเหตุ

มีปัญหาเกี่ยวกับโครงสร้างหรือกระบวนการในระบบ API
การเชื่อมต่อหรือกระบวนการภายในเซิร์ฟเวอร์ล้มเหลว
มีการร้องขอที่เกินความสามารถของระบบ หรือข้อผิดพลาดทางเทคนิคที่ไม่คาดคิด
วิธีแก้ไข

ลองทำคำขอใหม่ในภายหลังรอให้ระบบแก้ไขปัญหา และลองเรียกใช้งาน API อีกครั้ง
ตรวจสอบคำขอที่ส่งยืนยันว่าข้อมูลในคำขอถูกต้อง เช่น URL, Header, หรือ Payload
ติดต่อฝ่ายสนับสนุน EasySlipแจ้งรายละเอียดปัญหาให้ทีมสนับสนุนทราบ เช่น Endpoint ที่เรียกใช้ เวลาในการส่งคำขอ และ Response ที่ได้รับ

Verify Bank Slip By Image
Send a image for verification

คำอธิบาย Endpoint นี้ใช้สำหรับตรวจสอบข้อมูลในสลิปธนาคารโดยการส่งภาพ (Image)

URL: /verify
Method: POST
Headers:
Content-Type: multipart/form-data
Authorization: Bearer YOUR_ACCESS_TOKEN
(แทนที่ YOUR_ACCESS_TOKEN ด้วยโทเค็นจริงที่คุณได้รับหลังจากซื้อแพ็กเกจ)
Form Data:
file (file, required): Slip or QR Code image from bank
checkDuplicate (boolean, optional): Check duplicate
Request Example (ตัวอย่างคำขอ)

curl --location 'https://developer.easyslip.com/api/v1/verify' \
--header 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
--form 'file=@"slip.jpg"
Response Type (รูปแบบข้อมูลตอบกลับ)

type Data = {
    status: number
    data: {
        payload: string
        transRef: string
        date: string
        countryCode: string
        amount: {
            amount: number
            local: {
                amount?: number
                currency?: string
            }
        }
        fee?: number
        ref1?: string
        ref2?: string
        ref3?: string
        sender: {
            bank: {
                id?: string
                name?: string
                short?: string
            }
            account: {
                name: {
                    th?: string
                    en?: string
                }
                bank?: {
                    type: 'BANKAC' | 'TOKEN' | 'DUMMY'
                    account: string
                }
                proxy?: {
                    type: 'NATID' | 'MSISDN' | 'EWALLETID' | 'EMAIL' | 'BILLERID'
                    account: string
                }
            }
        }
        receiver: {
            bank: {
                id: string
                name?: string
                short?: string
            }
            account: {
                name: {
                    th?: string
                    en?: string
                }
                bank?: {
                    type: 'BANKAC' | 'TOKEN' | 'DUMMY'
                    account: string
                }
                proxy?: {
                    type: 'NATID' | 'MSISDN' | 'EWALLETID' | 'EMAIL' | 'BILLERID'
                    account: string
                }
            }
            merchantId?: string
        }
    }
}
Response Example (ตัวอย่างข้อมูลตอบกลับ)
Success (HTTP 200)

{
  "status": 200,
  "data": {
    "payload": "00000000000000000000000000000000000000000000000000000000000",
    "transRef": "68370160657749I376388B35",
    "date": "2023-01-01T00:00:00+07:00",
    "countryCode": "TH",
    "amount": {
      "amount": 1000,
      "local": {
        "amount": 0,
        "currency": ""
      }
    },
    "fee": 0,
    "ref1": "",
    "ref2": "",
    "ref3": "",
    "sender": {
      "bank": {
        "id": "001",
        "name": "กสิกรไทย",
        "short": "KBANK"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป",
          "en": "MR. EASY SLIP"
        },
        "bank": {
          "type": "BANKAC",
          "account": "1234xxxx5678"
        }
      }
    },
    "receiver": {
      "bank": {
        "id": "030",
        "name": "ธนาคารออมสิน",
        "short": "GSB"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป"
        },
        "bank": {
          "type": "BANKAC",
          "account": "12xxxx3456"
        },
        "proxy": {
          "type": "EWALLETID",
          "account": "123xxxxxxxx4567"
        }
      }
    }
  }
}
Error (HTTP 400)
invalid_payload

{
  "status": 400,
  "message": "invalid_payload"
}
สาเหตุ

Payload ที่ส่งมาไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบรูปแบบของ Payload และส่งใหม่
invalid_image

{
  "status": 400,
  "message": "invalid_image"
}
สาเหตุ

ไฟล์ภาพไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบว่าไฟล์เป็นภาพและไม่เสียหาย
invalid_check_duplicate

{
  "status": 400,
  "message": "invalid_check_duplicate"
}
สาเหตุ

checkDuplicate ที่ส่งมาไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบรูปแบบของ checkDuplicate และส่งใหม่
duplicate_slip

{
  "status": 400,
  "message": "duplicate_slip",
  "data": {
    "payload": "00000000000000000000000000000000000000000000000000000000000",
    "transRef": "68370160657749I376388B35",
    "date": "2023-01-01T00:00:00+07:00",
    "countryCode": "TH",
    "amount": {
      "amount": 1000,
      "local": {
        "amount": 0,
        "currency": ""
      }
    },
    "fee": 0,
    "ref1": "",
    "ref2": "",
    "ref3": "",
    "sender": {
      "bank": {
        "id": "001",
        "name": "กสิกรไทย",
        "short": "KBANK"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป",
          "en": "MR. EASY SLIP"
        },
        "bank": {
          "type": "BANKAC",
          "account": "1234xxxx5678"
        }
      }
    },
    "receiver": {
      "bank": {
        "id": "030",
        "name": "ธนาคารออมสิน",
        "short": "GSB"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป"
        },
        "bank": {
          "type": "BANKAC",
          "account": "12xxxx3456"
        },
        "proxy": {
          "type": "EWALLETID",
          "account": "123xxxxxxxx4567"
        }
      }
    }
  }
}
image_size_too_large

{
  "status": 400,
  "message": "image_size_too_large"
}
สาเหตุ

ขนาดไฟล์ภาพเกินกำหนด
วิธีแก้ไข

ลดขนาดไฟล์ภาพแล้วลองใหม่
Error (HTTP 401)
unauthorized

{
  "status": 401,
  "message": "unauthorized"
}
สาเหตุ

Access Token ไม่ถูกต้องหรือไม่ได้ใส่
วิธีแก้ไข

ตรวจสอบใน Header และใส่ Access Token ให้ถูกต้อง
Error (HTTP 403)
access_denied

{
  "status": 403,
  "message": "access_denied"
}
สาเหตุ

บัญชีของคุณไม่มีสิทธิ์ใช้งาน API นี้
วิธีแก้ไข

ตรวจสอบสิทธิ์การใช้งานกับทีมสนับสนุน
account_not_verified

{
  "status": 403,
  "message": "account_not_verified"
}
สาเหตุ

บัญชีผู้ใช้ไม่ได้ทำการยืนยัน KYC
วิธีแก้ไข

ติดต่อทีมสนับสนุน
application_expired

{
  "status": 403,
  "message": "application_expired"
}
สาเหตุ

ระยะเวลาการใช้งานหรือการสมัครสมาชิกของแอปพลิเคชันหมดอายุ
วิธีแก้ไข

ตรวจสอบสถานะของแอปพลิเคชันเข้าสู่ระบบในพอร์ทัล EasySlip และตรวจสอบว่าสถานะของแอปพลิเคชันหมดอายุหรือไม่
ดำเนินการต่ออายุการใช้งานหรือสมัครแพ็กเกจใหม่ให้เหมาะสมกับการใช้งาน
ติดต่อฝ่ายสนับสนุน EasySlip หากแอปพลิเคชันยังอยู่ในช่วงเวลาที่ควรใช้งานได้ แต่พบปัญหา ให้ติดต่อฝ่ายสนับสนุนเพื่อตรวจสอบและแก้ไขสถานะ
application_deactivated

{
  "status": 403,
  "message": "application_deactivated"
}
สาเหตุ

แอปพลิเคชันถูกปิดใช้งานโดยเจ้าของบัญชี หรือทีมสนับสนุนของ EasySlip
มีการละเมิดข้อกำหนดและเงื่อนไขการใช้งาน ทำให้ระบบปิดใช้งานแอปพลิเคชันโดยอัตโนมัติ
วิธีแก้ไข

ตรวจสอบสถานะของแอปพลิเคชันในระบบเข้าสู่ระบบในพอร์ทัล EasySlip และตรวจสอบว่าแอปพลิเคชันถูกปิดใช้งานหรือไม่หากคุณเป็นเจ้าของบัญชี ลองเปิดใช้งานแอปพลิเคชันใหม่ผ่านเมนูจัดการบัญชี
ติดต่อฝ่ายสนับสนุน EasySlip หากแอปพลิเคชันถูกปิดใช้งานโดยไม่มีการแจ้งล่วงหน้า ให้ติดต่อทีมสนับสนุนเพื่อขอข้อมูลเพิ่มเติม
quota_exceeded

{
  "status": 403,
  "message": "quota_exceeded"
}
สาเหตุ

คุณได้ใช้งาน API จนครบจำนวนครั้งที่โควต้าของบัญชีหรือแพ็กเกจกำหนด
ไม่มีการเติมโควต้าหรืออัปเกรดแพ็กเกจเพื่อเพิ่มจำนวนครั้งที่สามารถใช้งานได้
วิธีแก้ไข

ตรวจสอบสถานะโควต้าปัจจุบันเข้าสู่ระบบในพอร์ทัล EasySlip เพื่อดูจำนวนโควต้าที่เหลือหรือที่ใช้งานไปแล้ว
เพิ่มหรือต่ออายุโควต้าดำเนินการซื้อแพ็กเกจเพิ่มเติมหรืออัปเกรดบัญชีเพื่อเพิ่มโควต้าการใช้งาน
ติดต่อฝ่ายสนับสนุน EasySlip หากคุณเชื่อว่าข้อผิดพลาดเกิดจากระบบ หรือโควต้าควรมีเหลืออยู่ ให้ติดต่อฝ่ายสนับสนุนเพื่อตรวจสอบ
Error (HTTP 404)
slip_not_found

{
  "status": 404,
  "message": "slip_not_found"
}
สาเหตุ

ข้อมูลสลิปที่ส่งมาไม่ถูกต้องหรือไม่ตรงกับฐานข้อมูล
สลิปที่พยายามตรวจสอบไม่มีอยู่ในระบบ (อาจเกิดจากสลิปปลอม หรือข้อมูลที่ผิดพลาดจากธนาคารผุ้ออกสลิป)
วิธีแก้ไข

ตรวจสอบข้อมูลที่ส่งมายืนยันว่าข้อมูล Payload, เลขอ้างอิง, หรือรายละเอียดสลิปถูกต้องครบถ้วนตรวจสอบรูปแบบของข้อมูลตามที่ระบบกำหนด
ติดต่อฝ่ายสนับสนุน EasySlip หากมั่นใจว่าข้อมูลที่ส่งถูกต้อง แต่ยังเกิดปัญหา ให้ติดต่อทีมสนับสนุนเพื่อขอคำแนะนำเพิ่มเติม
qrcode_not_found

{
  "status": 404,
  "message": "qrcode_not_found"
}
สาเหตุ

QR Code ที่ส่งมาอาจไม่ถูกต้อง หรือรูปแบบไม่เป็นไปตามที่ระบบรองรับ
QR Code อาจหมดอายุ
วิธีแก้ไข

ตรวจสอบ QR Code ที่ส่งมามีข้อมูลครบถ้วนและเป็นรูปแบบที่ถูกต้อง
ติดต่อฝ่ายสนับสนุน EasySlip หาก QR Code ถูกต้อง แต่ยังเกิดปัญหา ให้ติดต่อทีมสนับสนุนเพื่อช่วยตรวจสอบ
Error (HTTP 500)
server_error

{
  "status": 500,
  "message": "server_error"
}
สาเหตุ

มีข้อผิดพลาดภายในระบบเซิร์ฟเวอร์ของ Easyslip
ปัญหาทางเทคนิค เช่น ระบบล่ม ฐานข้อมูลขัดข้อง หรือโค้ดที่ทำงานไม่ถูกต้อง
การสื่อสารระหว่างเซิร์ฟเวอร์และบริการที่เกี่ยวข้องล้มเหลว
วิธีแก้ไข

ลองทำคำขอใหม่ในภายหลังอาจเป็นปัญหาชั่วคราวของเซิร์ฟเวอร์ ให้รอและลองเรียกใช้ API อีกครั้ง
ตรวจสอบคำขอยืนยันว่าคำขอที่คุณส่งถูกต้องตามเอกสาร API เช่น รูปแบบของ Payload หรือ Headers
ติดต่อฝ่ายสนับสนุน EasySlip หากปัญหายังคงอยู่ ให้แจ้งทีมสนับสนุน พร้อมรายละเอียดคำขอ เช่น Endpoint, Request Body และเวลาที่ส่งคำขอ
api_server_error

{
  "status": 500,
  "message": "api_server_error"
}
สาเหตุ

มีปัญหาเกี่ยวกับโครงสร้างหรือกระบวนการในระบบ API
การเชื่อมต่อหรือกระบวนการภายในเซิร์ฟเวอร์ล้มเหลว
มีการร้องขอที่เกินความสามารถของระบบ หรือข้อผิดพลาดทางเทคนิคที่ไม่คาดคิด
วิธีแก้ไข

ลองทำคำขอใหม่ในภายหลังรอให้ระบบแก้ไขปัญหา และลองเรียกใช้งาน API อีกครั้ง
ตรวจสอบคำขอที่ส่งยืนยันว่าข้อมูลในคำขอถูกต้อง เช่น URL, Header, หรือ Payload
ติดต่อฝ่ายสนับสนุน EasySlipแจ้งรายละเอียดปัญหาให้ทีมสนับสนุนทราบ เช่น Endpoint ที่เรียกใช้ เวลาในการส่งคำขอ และ Response ที่ได้รับ

Verify Bank Slip By Base64
Send a image for verification

คำอธิบาย Endpoint นี้ใช้สำหรับตรวจสอบข้อมูลในสลิปธนาคารโดยการส่งข้อมูลในรูปแบบ Base64

URL: /verify
Method: POST
Headers:
Content-Type: application/json
Authorization: Bearer YOUR_ACCESS_TOKEN
(แทนที่ YOUR_ACCESS_TOKEN ด้วยโทเค็นจริงที่คุณได้รับหลังจากซื้อแพ็กเกจ)
Body (JSON):
image (string, required): Image base64 encoded
checkDuplicate (boolean, optional): Check duplicate
Request Example (ตัวอย่างคำขอ)

curl --location 'https://developer.easyslip.com/api/v1/verify' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
--data '{
    "image": "BASE64"
}'
Response Type (รูปแบบข้อมูลตอบกลับ)

type Data = {
    status: number
    data: {
        payload: string
        transRef: string
        date: string
        countryCode: string
        amount: {
            amount: number
            local: {
                amount?: number
                currency?: string
            }
        }
        fee?: number
        ref1?: string
        ref2?: string
        ref3?: string
        sender: {
            bank: {
                id?: string
                name?: string
                short?: string
            }
            account: {
                name: {
                    th?: string
                    en?: string
                }
                bank?: {
                    type: 'BANKAC' | 'TOKEN' | 'DUMMY'
                    account: string
                }
                proxy?: {
                    type: 'NATID' | 'MSISDN' | 'EWALLETID' | 'EMAIL' | 'BILLERID'
                    account: string
                }
            }
        }
        receiver: {
            bank: {
                id: string
                name?: string
                short?: string
            }
            account: {
                name: {
                    th?: string
                    en?: string
                }
                bank?: {
                    type: 'BANKAC' | 'TOKEN' | 'DUMMY'
                    account: string
                }
                proxy?: {
                    type: 'NATID' | 'MSISDN' | 'EWALLETID' | 'EMAIL' | 'BILLERID'
                    account: string
                }
            }
            merchantId?: string
        }
    }
}
Response Example (ตัวอย่างข้อมูลตอบกลับ)
Success (HTTP 200)

{
  "status": 200,
  "data": {
    "payload": "00000000000000000000000000000000000000000000000000000000000",
    "transRef": "68370160657749I376388B35",
    "date": "2023-01-01T00:00:00+07:00",
    "countryCode": "TH",
    "amount": {
      "amount": 1000,
      "local": {
        "amount": 0,
        "currency": ""
      }
    },
    "fee": 0,
    "ref1": "",
    "ref2": "",
    "ref3": "",
    "sender": {
      "bank": {
        "id": "001",
        "name": "กสิกรไทย",
        "short": "KBANK"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป",
          "en": "MR. EASY SLIP"
        },
        "bank": {
          "type": "BANKAC",
          "account": "1234xxxx5678"
        }
      }
    },
    "receiver": {
      "bank": {
        "id": "030",
        "name": "ธนาคารออมสิน",
        "short": "GSB"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป"
        },
        "bank": {
          "type": "BANKAC",
          "account": "12xxxx3456"
        },
        "proxy": {
          "type": "EWALLETID",
          "account": "123xxxxxxxx4567"
        }
      }
    }
  }
}
Error (HTTP 400)
invalid_payload

{
  "status": 400,
  "message": "invalid_payload"
}
สาเหตุ

Payload ที่ส่งมาไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบรูปแบบของ Payload และส่งใหม่
invalid_check_duplicate

{
  "status": 400,
  "message": "invalid_check_duplicate"
}
สาเหตุ

checkDuplicate ที่ส่งมาไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบรูปแบบของ checkDuplicate และส่งใหม่
duplicate_slip

{
  "status": 400,
  "message": "duplicate_slip",
  "data": {
    "payload": "00000000000000000000000000000000000000000000000000000000000",
    "transRef": "68370160657749I376388B35",
    "date": "2023-01-01T00:00:00+07:00",
    "countryCode": "TH",
    "amount": {
      "amount": 1000,
      "local": {
        "amount": 0,
        "currency": ""
      }
    },
    "fee": 0,
    "ref1": "",
    "ref2": "",
    "ref3": "",
    "sender": {
      "bank": {
        "id": "001",
        "name": "กสิกรไทย",
        "short": "KBANK"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป",
          "en": "MR. EASY SLIP"
        },
        "bank": {
          "type": "BANKAC",
          "account": "1234xxxx5678"
        }
      }
    },
    "receiver": {
      "bank": {
        "id": "030",
        "name": "ธนาคารออมสิน",
        "short": "GSB"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป"
        },
        "bank": {
          "type": "BANKAC",
          "account": "12xxxx3456"
        },
        "proxy": {
          "type": "EWALLETID",
          "account": "123xxxxxxxx4567"
        }
      }
    }
  }
}
invalid_image

{
  "status": 400,
  "message": "invalid_image"
}
สาเหตุ

ไฟล์ภาพไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบว่าไฟล์เป็นภาพและไม่เสียหาย
image_size_too_large

{
  "status": 400,
  "message": "image_size_too_large"
}
สาเหตุ

ขนาดไฟล์ภาพเกินกำหนด
วิธีแก้ไข

ลดขนาดไฟล์ภาพแล้วลองใหม่
Error (HTTP 401)
unauthorized

{
  "status": 401,
  "message": "unauthorized"
}
สาเหตุ

Access Token ไม่ถูกต้องหรือไม่ได้ใส่
วิธีแก้ไข

ตรวจสอบใน Header และใส่ Access Token ให้ถูกต้อง
Error (HTTP 403)
access_denied

{
  "status": 403,
  "message": "access_denied"
}
สาเหตุ

บัญชีของคุณไม่มีสิทธิ์ใช้งาน API นี้
วิธีแก้ไข

ตรวจสอบสิทธิ์การใช้งานกับทีมสนับสนุน
account_not_verified

{
  "status": 403,
  "message": "account_not_verified"
}
สาเหตุ

บัญชีผู้ใช้ไม่ได้ทำการยืนยัน KYC
วิธีแก้ไข

ติดต่อทีมสนับสนุน
application_expired

{
  "status": 403,
  "message": "application_expired"
}
สาเหตุ

ระยะเวลาการใช้งานหรือการสมัครสมาชิกของแอปพลิเคชันหมดอายุ
วิธีแก้ไข

ตรวจสอบสถานะของแอปพลิเคชันเข้าสู่ระบบในพอร์ทัล EasySlip และตรวจสอบว่าสถานะของแอปพลิเคชันหมดอายุหรือไม่
ดำเนินการต่ออายุการใช้งานหรือสมัครแพ็กเกจใหม่ให้เหมาะสมกับการใช้งาน
ติดต่อฝ่ายสนับสนุน EasySlip หากแอปพลิเคชันยังอยู่ในช่วงเวลาที่ควรใช้งานได้ แต่พบปัญหา ให้ติดต่อฝ่ายสนับสนุนเพื่อตรวจสอบและแก้ไขสถานะ
application_deactivated

{
  "status": 403,
  "message": "application_deactivated"
}
สาเหตุ

แอปพลิเคชันถูกปิดใช้งานโดยเจ้าของบัญชี หรือทีมสนับสนุนของ EasySlip
มีการละเมิดข้อกำหนดและเงื่อนไขการใช้งาน ทำให้ระบบปิดใช้งานแอปพลิเคชันโดยอัตโนมัติ
วิธีแก้ไข

ตรวจสอบสถานะของแอปพลิเคชันในระบบเข้าสู่ระบบในพอร์ทัล EasySlip และตรวจสอบว่าแอปพลิเคชันถูกปิดใช้งานหรือไม่หากคุณเป็นเจ้าของบัญชี ลองเปิดใช้งานแอปพลิเคชันใหม่ผ่านเมนูจัดการบัญชี
ติดต่อฝ่ายสนับสนุน EasySlip หากแอปพลิเคชันถูกปิดใช้งานโดยไม่มีการแจ้งล่วงหน้า ให้ติดต่อทีมสนับสนุนเพื่อขอข้อมูลเพิ่มเติม
quota_exceeded

{
  "status": 403,
  "message": "quota_exceeded"
}
สาเหตุ

คุณได้ใช้งาน API จนครบจำนวนครั้งที่โควต้าของบัญชีหรือแพ็กเกจกำหนด
ไม่มีการเติมโควต้าหรืออัปเกรดแพ็กเกจเพื่อเพิ่มจำนวนครั้งที่สามารถใช้งานได้
วิธีแก้ไข

ตรวจสอบสถานะโควต้าปัจจุบันเข้าสู่ระบบในพอร์ทัล EasySlip เพื่อดูจำนวนโควต้าที่เหลือหรือที่ใช้งานไปแล้ว
เพิ่มหรือต่ออายุโควต้าดำเนินการซื้อแพ็กเกจเพิ่มเติมหรืออัปเกรดบัญชีเพื่อเพิ่มโควต้าการใช้งาน
ติดต่อฝ่ายสนับสนุน EasySlip หากคุณเชื่อว่าข้อผิดพลาดเกิดจากระบบ หรือโควต้าควรมีเหลืออยู่ ให้ติดต่อฝ่ายสนับสนุนเพื่อตรวจสอบ
Error (HTTP 404)
slip_not_found

{
  "status": 404,
  "message": "slip_not_found"
}
สาเหตุ

ข้อมูลสลิปที่ส่งมาไม่ถูกต้องหรือไม่ตรงกับฐานข้อมูล
สลิปที่พยายามตรวจสอบไม่มีอยู่ในระบบ (อาจเกิดจากสลิปปลอม หรือข้อมูลที่ผิดพลาดจากธนาคารผุ้ออกสลิป)
วิธีแก้ไข

ตรวจสอบข้อมูลที่ส่งมายืนยันว่าข้อมูล Payload, เลขอ้างอิง, หรือรายละเอียดสลิปถูกต้องครบถ้วนตรวจสอบรูปแบบของข้อมูลตามที่ระบบกำหนด
ติดต่อฝ่ายสนับสนุน EasySlip หากมั่นใจว่าข้อมูลที่ส่งถูกต้อง แต่ยังเกิดปัญหา ให้ติดต่อทีมสนับสนุนเพื่อขอคำแนะนำเพิ่มเติม
qrcode_not_found

{
  "status": 404,
  "message": "qrcode_not_found"
}
สาเหตุ

QR Code ที่ส่งมาอาจไม่ถูกต้อง หรือรูปแบบไม่เป็นไปตามที่ระบบรองรับ
QR Code อาจหมดอายุ
วิธีแก้ไข

ตรวจสอบ QR Code ที่ส่งมามีข้อมูลครบถ้วนและเป็นรูปแบบที่ถูกต้อง
ติดต่อฝ่ายสนับสนุน EasySlip หาก QR Code ถูกต้อง แต่ยังเกิดปัญหา ให้ติดต่อทีมสนับสนุนเพื่อช่วยตรวจสอบ
Error (HTTP 500)
server_error

{
  "status": 500,
  "message": "server_error"
}
สาเหตุ

มีข้อผิดพลาดภายในระบบเซิร์ฟเวอร์ของ Easyslip
ปัญหาทางเทคนิค เช่น ระบบล่ม ฐานข้อมูลขัดข้อง หรือโค้ดที่ทำงานไม่ถูกต้อง
การสื่อสารระหว่างเซิร์ฟเวอร์และบริการที่เกี่ยวข้องล้มเหลว
วิธีแก้ไข

ลองทำคำขอใหม่ในภายหลังอาจเป็นปัญหาชั่วคราวของเซิร์ฟเวอร์ ให้รอและลองเรียกใช้ API อีกครั้ง
ตรวจสอบคำขอยืนยันว่าคำขอที่คุณส่งถูกต้องตามเอกสาร API เช่น รูปแบบของ Payload หรือ Headers
ติดต่อฝ่ายสนับสนุน EasySlip หากปัญหายังคงอยู่ ให้แจ้งทีมสนับสนุน พร้อมรายละเอียดคำขอ เช่น Endpoint, Request Body และเวลาที่ส่งคำขอ
api_server_error

{
  "status": 500,
  "message": "api_server_error"
}
สาเหตุ

มีปัญหาเกี่ยวกับโครงสร้างหรือกระบวนการในระบบ API
การเชื่อมต่อหรือกระบวนการภายในเซิร์ฟเวอร์ล้มเหลว
มีการร้องขอที่เกินความสามารถของระบบ หรือข้อผิดพลาดทางเทคนิคที่ไม่คาดคิด
วิธีแก้ไข

ลองทำคำขอใหม่ในภายหลังรอให้ระบบแก้ไขปัญหา และลองเรียกใช้งาน API อีกครั้ง
ตรวจสอบคำขอที่ส่งยืนยันว่าข้อมูลในคำขอถูกต้อง เช่น URL, Header, หรือ Payload
ติดต่อฝ่ายสนับสนุน EasySlipแจ้งรายละเอียดปัญหาให้ทีมสนับสนุนทราบ เช่น Endpoint ที่เรียกใช้ เวลาในการส่งคำขอ และ Response ที่ได้รับ

Verify Bank Slip By URL
Send a image for verification

คำอธิบาย Endpoint นี้ใช้สำหรับตรวจสอบข้อมูลในสลิปธนาคารโดยการส่งข้อมูลในรูปแบบ URL

URL: /verify
Method: POST
Headers:
Content-Type: application/json
Authorization: Bearer YOUR_ACCESS_TOKEN
(แทนที่ YOUR_ACCESS_TOKEN ด้วยโทเค็นจริงที่คุณได้รับหลังจากซื้อแพ็กเกจ)
Body (JSON):
url (string, required): Image url
checkDuplicate (boolean, optional): Check duplicate
Request Example (ตัวอย่างคำขอ)

curl --location 'https://developer.easyslip.com/api/v1/verify' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
--data '{
    "url": "URL"
}'
Response Type (รูปแบบข้อมูลตอบกลับ)

type Data = {
    status: number
    data: {
        payload: string
        transRef: string
        date: string
        countryCode: string
        amount: {
            amount: number
            local: {
                amount?: number
                currency?: string
            }
        }
        fee?: number
        ref1?: string
        ref2?: string
        ref3?: string
        sender: {
            bank: {
                id?: string
                name?: string
                short?: string
            }
            account: {
                name: {
                    th?: string
                    en?: string
                }
                bank?: {
                    type: 'BANKAC' | 'TOKEN' | 'DUMMY'
                    account: string
                }
                proxy?: {
                    type: 'NATID' | 'MSISDN' | 'EWALLETID' | 'EMAIL' | 'BILLERID'
                    account: string
                }
            }
        }
        receiver: {
            bank: {
                id: string
                name?: string
                short?: string
            }
            account: {
                name: {
                    th?: string
                    en?: string
                }
                bank?: {
                    type: 'BANKAC' | 'TOKEN' | 'DUMMY'
                    account: string
                }
                proxy?: {
                    type: 'NATID' | 'MSISDN' | 'EWALLETID' | 'EMAIL' | 'BILLERID'
                    account: string
                }
            }
            merchantId?: string
        }
    }
}
Response Example (ตัวอย่างข้อมูลตอบกลับ)
Success (HTTP 200)

{
  "status": 200,
  "data": {
    "payload": "00000000000000000000000000000000000000000000000000000000000",
    "transRef": "68370160657749I376388B35",
    "date": "2023-01-01T00:00:00+07:00",
    "countryCode": "TH",
    "amount": {
      "amount": 1000,
      "local": {
        "amount": 0,
        "currency": ""
      }
    },
    "fee": 0,
    "ref1": "",
    "ref2": "",
    "ref3": "",
    "sender": {
      "bank": {
        "id": "001",
        "name": "กสิกรไทย",
        "short": "KBANK"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป",
          "en": "MR. EASY SLIP"
        },
        "bank": {
          "type": "BANKAC",
          "account": "1234xxxx5678"
        }
      }
    },
    "receiver": {
      "bank": {
        "id": "030",
        "name": "ธนาคารออมสิน",
        "short": "GSB"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป"
        },
        "bank": {
          "type": "BANKAC",
          "account": "12xxxx3456"
        },
        "proxy": {
          "type": "EWALLETID",
          "account": "123xxxxxxxx4567"
        }
      }
    }
  }
}
Error (HTTP 400)
invalid_url

{
  "status": 400,
  "message": "invalid_url"
}
สาเหตุ

รูปแบบ URL ไม่ถูกต้องหรือไม่ได้รับอนุญาต
วิธีแก้ไข

ตรวจสอบ URL และส่งใหม่
invalid_payload

{
  "status": 400,
  "message": "invalid_payload"
}
สาเหตุ

Payload ที่ส่งมาไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบรูปแบบของ Payload และส่งใหม่
invalid_check_duplicate

{
  "status": 400,
  "message": "invalid_check_duplicate"
}
สาเหตุ

checkDuplicate ที่ส่งมาไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบรูปแบบของ checkDuplicate และส่งใหม่
duplicate_slip

{
  "status": 400,
  "message": "duplicate_slip",
  "data": {
    "payload": "00000000000000000000000000000000000000000000000000000000000",
    "transRef": "68370160657749I376388B35",
    "date": "2023-01-01T00:00:00+07:00",
    "countryCode": "TH",
    "amount": {
      "amount": 1000,
      "local": {
        "amount": 0,
        "currency": ""
      }
    },
    "fee": 0,
    "ref1": "",
    "ref2": "",
    "ref3": "",
    "sender": {
      "bank": {
        "id": "001",
        "name": "กสิกรไทย",
        "short": "KBANK"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป",
          "en": "MR. EASY SLIP"
        },
        "bank": {
          "type": "BANKAC",
          "account": "1234xxxx5678"
        }
      }
    },
    "receiver": {
      "bank": {
        "id": "030",
        "name": "ธนาคารออมสิน",
        "short": "GSB"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป"
        },
        "bank": {
          "type": "BANKAC",
          "account": "12xxxx3456"
        },
        "proxy": {
          "type": "EWALLETID",
          "account": "123xxxxxxxx4567"
        }
      }
    }
  }
}
invalid_image

{
  "status": 400,
  "message": "invalid_image"
}
สาเหตุ

ไฟล์ภาพไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบว่าไฟล์เป็นภาพและไม่เสียหาย
image_size_too_large

{
  "status": 400,
  "message": "image_size_too_large"
}
สาเหตุ

ขนาดไฟล์ภาพเกินกำหนด
วิธีแก้ไข

ลดขนาดไฟล์ภาพแล้วลองใหม่
Error (HTTP 401)
unauthorized

{
  "status": 401,
  "message": "unauthorized"
}
สาเหตุ

Access Token ไม่ถูกต้องหรือไม่ได้ใส่
วิธีแก้ไข

ตรวจสอบใน Header และใส่ Access Token ให้ถูกต้อง
Error (HTTP 403)
access_denied

{
  "status": 403,
  "message": "access_denied"
}
สาเหตุ

บัญชีของคุณไม่มีสิทธิ์ใช้งาน API นี้
วิธีแก้ไข

ตรวจสอบสิทธิ์การใช้งานกับทีมสนับสนุน
account_not_verified

{
  "status": 403,
  "message": "account_not_verified"
}
สาเหตุ

บัญชีผู้ใช้ไม่ได้ทำการยืนยัน KYC
วิธีแก้ไข

ติดต่อทีมสนับสนุน
application_expired

{
  "status": 403,
  "message": "application_expired"
}
สาเหตุ

ระยะเวลาการใช้งานหรือการสมัครสมาชิกของแอปพลิเคชันหมดอายุ
วิธีแก้ไข

ตรวจสอบสถานะของแอปพลิเคชันเข้าสู่ระบบในพอร์ทัล EasySlip และตรวจสอบว่าสถานะของแอปพลิเคชันหมดอายุหรือไม่
ดำเนินการต่ออายุการใช้งานหรือสมัครแพ็กเกจใหม่ให้เหมาะสมกับการใช้งาน
ติดต่อฝ่ายสนับสนุน EasySlip หากแอปพลิเคชันยังอยู่ในช่วงเวลาที่ควรใช้งานได้ แต่พบปัญหา ให้ติดต่อฝ่ายสนับสนุนเพื่อตรวจสอบและแก้ไขสถานะ
application_deactivated

{
  "status": 403,
  "message": "application_deactivated"
}
สาเหตุ

แอปพลิเคชันถูกปิดใช้งานโดยเจ้าของบัญชี หรือทีมสนับสนุนของ EasySlip
มีการละเมิดข้อกำหนดและเงื่อนไขการใช้งาน ทำให้ระบบปิดใช้งานแอปพลิเคชันโดยอัตโนมัติ
วิธีแก้ไข

ตรวจสอบสถานะของแอปพลิเคชันในระบบเข้าสู่ระบบในพอร์ทัล EasySlip และตรวจสอบว่าแอปพลิเคชันถูกปิดใช้งานหรือไม่หากคุณเป็นเจ้าของบัญชี ลองเปิดใช้งานแอปพลิเคชันใหม่ผ่านเมนูจัดการบัญชี
ติดต่อฝ่ายสนับสนุน EasySlip หากแอปพลิเคชันถูกปิดใช้งานโดยไม่มีการแจ้งล่วงหน้า ให้ติดต่อทีมสนับสนุนเพื่อขอข้อมูลเพิ่มเติม
quota_exceeded

{
  "status": 403,
  "message": "quota_exceeded"
}
สาเหตุ

คุณได้ใช้งาน API จนครบจำนวนครั้งที่โควต้าของบัญชีหรือแพ็กเกจกำหนด
ไม่มีการเติมโควต้าหรืออัปเกรดแพ็กเกจเพื่อเพิ่มจำนวนครั้งที่สามารถใช้งานได้
วิธีแก้ไข

ตรวจสอบสถานะโควต้าปัจจุบันเข้าสู่ระบบในพอร์ทัล EasySlip เพื่อดูจำนวนโควต้าที่เหลือหรือที่ใช้งานไปแล้ว
เพิ่มหรือต่ออายุโควต้าดำเนินการซื้อแพ็กเกจเพิ่มเติมหรืออัปเกรดบัญชีเพื่อเพิ่มโควต้าการใช้งาน
ติดต่อฝ่ายสนับสนุน EasySlip หากคุณเชื่อว่าข้อผิดพลาดเกิดจากระบบ หรือโควต้าควรมีเหลืออยู่ ให้ติดต่อฝ่ายสนับสนุนเพื่อตรวจสอบ
Error (HTTP 404)
slip_not_found

{
  "status": 404,
  "message": "slip_not_found"
}
สาเหตุ

ข้อมูลสลิปที่ส่งมาไม่ถูกต้องหรือไม่ตรงกับฐานข้อมูล
สลิปที่พยายามตรวจสอบไม่มีอยู่ในระบบ (อาจเกิดจากสลิปปลอม หรือข้อมูลที่ผิดพลาดจากธนาคารผุ้ออกสลิป)
วิธีแก้ไข

ตรวจสอบข้อมูลที่ส่งมายืนยันว่าข้อมูล Payload, เลขอ้างอิง, หรือรายละเอียดสลิปถูกต้องครบถ้วนตรวจสอบรูปแบบของข้อมูลตามที่ระบบกำหนด
ติดต่อฝ่ายสนับสนุน EasySlip หากมั่นใจว่าข้อมูลที่ส่งถูกต้อง แต่ยังเกิดปัญหา ให้ติดต่อทีมสนับสนุนเพื่อขอคำแนะนำเพิ่มเติม
qrcode_not_found

{
  "status": 404,
  "message": "qrcode_not_found"
}
สาเหตุ

QR Code ที่ส่งมาอาจไม่ถูกต้อง หรือรูปแบบไม่เป็นไปตามที่ระบบรองรับ
QR Code อาจหมดอายุ
วิธีแก้ไข

ตรวจสอบ QR Code ที่ส่งมามีข้อมูลครบถ้วนและเป็นรูปแบบที่ถูกต้อง
ติดต่อฝ่ายสนับสนุน EasySlip หาก QR Code ถูกต้อง แต่ยังเกิดปัญหา ให้ติดต่อทีมสนับสนุนเพื่อช่วยตรวจสอบ
Error (HTTP 500)
server_error

{
  "status": 500,
  "message": "server_error"
}
สาเหตุ

มีข้อผิดพลาดภายในระบบเซิร์ฟเวอร์ของ Easyslip
ปัญหาทางเทคนิค เช่น ระบบล่ม ฐานข้อมูลขัดข้อง หรือโค้ดที่ทำงานไม่ถูกต้อง
การสื่อสารระหว่างเซิร์ฟเวอร์และบริการที่เกี่ยวข้องล้มเหลว
วิธีแก้ไข

ลองทำคำขอใหม่ในภายหลังอาจเป็นปัญหาชั่วคราวของเซิร์ฟเวอร์ ให้รอและลองเรียกใช้ API อีกครั้ง
ตรวจสอบคำขอยืนยันว่าคำขอที่คุณส่งถูกต้องตามเอกสาร API เช่น รูปแบบของ Payload หรือ Headers
ติดต่อฝ่ายสนับสนุน EasySlip หากปัญหายังคงอยู่ ให้แจ้งทีมสนับสนุน พร้อมรายละเอียดคำขอ เช่น Endpoint, Request Body และเวลาที่ส่งคำขอ
api_server_error

{
  "status": 500,
  "message": "api_server_error"
}
สาเหตุ

มีปัญหาเกี่ยวกับโครงสร้างหรือกระบวนการในระบบ API
การเชื่อมต่อหรือกระบวนการภายในเซิร์ฟเวอร์ล้มเหลว
มีการร้องขอที่เกินความสามารถของระบบ หรือข้อผิดพลาดทางเทคนิคที่ไม่คาดคิด
วิธีแก้ไข

ลองทำคำขอใหม่ในภายหลังรอให้ระบบแก้ไขปัญหา และลองเรียกใช้งาน API อีกครั้ง
ตรวจสอบคำขอที่ส่งยืนยันว่าข้อมูลในคำขอถูกต้อง เช่น URL, Header, หรือ Payload
ติดต่อฝ่ายสนับสนุน EasySlipแจ้งรายละเอียดปัญหาให้ทีมสนับสนุนทราบ เช่น Endpoint ที่เรียกใช้ เวลาในการส่งคำขอ และ Response ที่ได้รับ

Verify Truemoney Wallet Slip By Image
Send a image for verification

คำอธิบาย: Endpoint นี้ใช้สำหรับตรวจสอบข้อมูลในสลิปจาก Truemoney Wallet โดยการส่งภาพ (Image)

URL: /verify/truewallet
Method: POST
Headers:
Content-Type: multipart/form-data
Authorization: Bearer YOUR_ACCESS_TOKEN
Form Data:
file (file, required): Slip or QR Code image from bank
checkDuplicate (boolean, optional): Check duplicate
Request Example (ตัวอย่างคำขอ)

curl --location 'https://developer.easyslip.com/api/v1/verify/truewallet' \
--header 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
--form 'file=@"slip.jpg"
Response Type (รูปแบบข้อมูลตอบกลับ)

type Data = {
    status: number
    data: {
        transactionId: string
        date: string
        amount: number
        sender: {
            name: string
        }
        receiver: {
            name: string
            phone: string
        }
    }
}
Response Example (ตัวอย่างข้อมูลตอบกลับ)
Success (HTTP 200)

{
  "status": 200,
  "data": {
    "transactionId": "00000000000000",
    "date": "2023-01-01T00:00:00+07:00",
    "amount": 1000,
    "sender": {
      "name": "อีซี่ สลิป"
    },
    "receiver": {
      "name": "อีซี่ สลิป",
      "phone": "098-***-4321"
    }
  }
}
Error (HTTP 400)
invalid_image

{
  "status": 400,
  "message": "invalid_image"
}
สาเหตุ

ไฟล์ภาพไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบว่าไฟล์เป็นภาพและไม่เสียหาย
invalid_check_duplicate

{
  "status": 400,
  "message": "invalid_check_duplicate"
}
duplicate_slip

{
  "status": 400,
  "message": "duplicate_slip",
  "data": {
    "payload": "00000000000000000000000000000000000000000000000000000000000",
    "transRef": "68370160657749I376388B35",
    "date": "2023-01-01T00:00:00+07:00",
    "countryCode": "TH",
    "amount": {
      "amount": 1000,
      "local": {
        "amount": 0,
        "currency": ""
      }
    },
    "fee": 0,
    "ref1": "",
    "ref2": "",
    "ref3": "",
    "sender": {
      "bank": {
        "id": "001",
        "name": "กสิกรไทย",
        "short": "KBANK"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป",
          "en": "MR. EASY SLIP"
        },
        "bank": {
          "type": "BANKAC",
          "account": "1234xxxx5678"
        }
      }
    },
    "receiver": {
      "bank": {
        "id": "030",
        "name": "ธนาคารออมสิน",
        "short": "GSB"
      },
      "account": {
        "name": {
          "th": "นาย อีซี่ สลิป"
        },
        "bank": {
          "type": "BANKAC",
          "account": "12xxxx3456"
        },
        "proxy": {
          "type": "EWALLETID",
          "account": "123xxxxxxxx4567"
        }
      }
    }
  }
}
สาเหตุ

checkDuplicate ที่ส่งมาไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบรูปแบบของ checkDuplicate และส่งใหม่
image_size_too_large

{
  "status": 400,
  "message": "image_size_too_large"
}
สาเหตุ

ขนาดไฟล์ภาพเกินกำหนด
วิธีแก้ไข

ลดขนาดไฟล์ภาพแล้วลองใหม่
invalid_transaction_id

{
  "status": 400,
  "message": "invalid_transaction_id"
}
สาเหตุ

หมายเลขรายการ (Transaction ID) ไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบข้อมูลในภาพ
invalid_amount

{
  "status": 400,
  "message": "invalid_amount"
}
สาเหตุ

จำนวนเงินไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบความถูกต้องของจำนวนเงิน
invalid_sender_name

{
  "status": 400,
  "message": "invalid_sender_name"
}
สาเหตุ

ชื่อผู้โอนไม่ตรงกับข้อมูลในระบบ
วิธีแก้ไข

ตรวจสอบชื่อผู้โอนในภาพ
invalid_receiver_name

{
  "status": 400,
  "message": "invalid_receiver_name"
}
สาเหตุ

ชื่อผู้รับไม่ตรงกับข้อมูลในระบบ
วิธีแก้ไข

ตรวจสอบชื่อผู้รับในภาพ
invalid_receiver_phone

{
  "status": 400,
  "message": "invalid_receiver_phone"
}
สาเหตุ

เบอร์โทรของผู้รับไม่ถูกต้อง
วิธีแก้ไข

ตรวจสอบเบอร์โทรในภาพ
Error (HTTP 401)
unauthorized

{
  "status": 401,
  "message": "unauthorized"
}
สาเหตุ

Access Token ไม่ถูกต้องหรือไม่ได้ใส่
วิธีแก้ไข

ตรวจสอบใน Header และใส่ Access Token ให้ถูกต้อง
Error (HTTP 403)
access_denied

{
  "status": 403,
  "message": "access_denied"
}
สาเหตุ

บัญชีของคุณไม่มีสิทธิ์ใช้งาน API นี้
วิธีแก้ไข

ตรวจสอบสิทธิ์การใช้งานกับทีมสนับสนุน
account_not_verified

{
  "status": 403,
  "message": "account_not_verified"
}
สาเหตุ

บัญชีผู้ใช้ไม่ได้ทำการยืนยัน KYC
วิธีแก้ไข

ติดต่อทีมสนับสนุน
application_expired

{
  "status": 403,
  "message": "application_expired"
}
สาเหตุ

ระยะเวลาการใช้งานหรือการสมัครสมาชิกของแอปพลิเคชันหมดอายุ
วิธีแก้ไข

ตรวจสอบสถานะของแอปพลิเคชันเข้าสู่ระบบในพอร์ทัล EasySlip และตรวจสอบว่าสถานะของแอปพลิเคชันหมดอายุหรือไม่
ดำเนินการต่ออายุการใช้งานหรือสมัครแพ็กเกจใหม่ให้เหมาะสมกับการใช้งาน
ติดต่อฝ่ายสนับสนุน EasySlip หากแอปพลิเคชันยังอยู่ในช่วงเวลาที่ควรใช้งานได้ แต่พบปัญหา ให้ติดต่อฝ่ายสนับสนุนเพื่อตรวจสอบและแก้ไขสถานะ
application_deactivated

{
  "status": 403,
  "message": "application_deactivated"
}
สาเหตุ

แอปพลิเคชันถูกปิดใช้งานโดยเจ้าของบัญชี หรือทีมสนับสนุนของ EasySlip
มีการละเมิดข้อกำหนดและเงื่อนไขการใช้งาน ทำให้ระบบปิดใช้งานแอปพลิเคชันโดยอัตโนมัติ
วิธีแก้ไข

ตรวจสอบสถานะของแอปพลิเคชันในระบบเข้าสู่ระบบในพอร์ทัล EasySlip และตรวจสอบว่าแอปพลิเคชันถูกปิดใช้งานหรือไม่หากคุณเป็นเจ้าของบัญชี ลองเปิดใช้งานแอปพลิเคชันใหม่ผ่านเมนูจัดการบัญชี
ติดต่อฝ่ายสนับสนุน EasySlip หากแอปพลิเคชันถูกปิดใช้งานโดยไม่มีการแจ้งล่วงหน้า ให้ติดต่อทีมสนับสนุนเพื่อขอข้อมูลเพิ่มเติม
quota_exceeded

{
  "status": 403,
  "message": "quota_exceeded"
}
สาเหตุ

คุณได้ใช้งาน API จนครบจำนวนครั้งที่โควต้าของบัญชีหรือแพ็กเกจกำหนด
ไม่มีการเติมโควต้าหรืออัปเกรดแพ็กเกจเพื่อเพิ่มจำนวนครั้งที่สามารถใช้งานได้
วิธีแก้ไข

ตรวจสอบสถานะโควต้าปัจจุบันเข้าสู่ระบบในพอร์ทัล EasySlip เพื่อดูจำนวนโควต้าที่เหลือหรือที่ใช้งานไปแล้ว
เพิ่มหรือต่ออายุโควต้าดำเนินการซื้อแพ็กเกจเพิ่มเติมหรืออัปเกรดบัญชีเพื่อเพิ่มโควต้าการใช้งาน
ติดต่อฝ่ายสนับสนุน EasySlip หากคุณเชื่อว่าข้อผิดพลาดเกิดจากระบบ หรือโควต้าควรมีเหลืออยู่ ให้ติดต่อฝ่ายสนับสนุนเพื่อตรวจสอบ
Error (HTTP 404)
slip_not_found

{
  "status": 404,
  "message": "slip_not_found"
}
สาเหตุ

ข้อมูลสลิปที่ส่งมาไม่ถูกต้องหรือไม่ตรงกับฐานข้อมูล
สลิปที่พยายามตรวจสอบไม่มีอยู่ในระบบ (อาจเกิดจากสลิปปลอม หรือข้อมูลที่ผิดพลาดจากธนาคารผุ้ออกสลิป)
วิธีแก้ไข

ตรวจสอบข้อมูลที่ส่งมายืนยันว่าข้อมูล Payload, เลขอ้างอิง, หรือรายละเอียดสลิปถูกต้องครบถ้วนตรวจสอบรูปแบบของข้อมูลตามที่ระบบกำหนด
ติดต่อฝ่ายสนับสนุน EasySlip หากมั่นใจว่าข้อมูลที่ส่งถูกต้อง แต่ยังเกิดปัญหา ให้ติดต่อทีมสนับสนุนเพื่อขอคำแนะนำเพิ่มเติม
qrcode_not_found

{
  "status": 404,
  "message": "qrcode_not_found"
}
สาเหตุ

QR Code ที่ส่งมาอาจไม่ถูกต้อง หรือรูปแบบไม่เป็นไปตามที่ระบบรองรับ
QR Code อาจหมดอายุ
วิธีแก้ไข

ตรวจสอบ QR Code ที่ส่งมามีข้อมูลครบถ้วนและเป็นรูปแบบที่ถูกต้อง
ติดต่อฝ่ายสนับสนุน EasySlip หาก QR Code ถูกต้อง แต่ยังเกิดปัญหา ให้ติดต่อทีมสนับสนุนเพื่อช่วยตรวจสอบ
Error (HTTP 500)
server_error

{
  "status": 500,
  "message": "server_error"
}
สาเหตุ

มีข้อผิดพลาดภายในระบบเซิร์ฟเวอร์ของ Easyslip
ปัญหาทางเทคนิค เช่น ระบบล่ม ฐานข้อมูลขัดข้อง หรือโค้ดที่ทำงานไม่ถูกต้อง
การสื่อสารระหว่างเซิร์ฟเวอร์และบริการที่เกี่ยวข้องล้มเหลว
วิธีแก้ไข

ลองทำคำขอใหม่ในภายหลังอาจเป็นปัญหาชั่วคราวของเซิร์ฟเวอร์ ให้รอและลองเรียกใช้ API อีกครั้ง
ตรวจสอบคำขอยืนยันว่าคำขอที่คุณส่งถูกต้องตามเอกสาร API เช่น รูปแบบของ Payload หรือ Headers
ติดต่อฝ่ายสนับสนุน EasySlip หากปัญหายังคงอยู่ ให้แจ้งทีมสนับสนุน พร้อมรายละเอียดคำขอ เช่น Endpoint, Request Body และเวลาที่ส่งคำขอ
api_server_error

{
  "status": 500,
  "message": "api_server_error"
}
สาเหตุ

มีปัญหาเกี่ยวกับโครงสร้างหรือกระบวนการในระบบ API
การเชื่อมต่อหรือกระบวนการภายในเซิร์ฟเวอร์ล้มเหลว
มีการร้องขอที่เกินความสามารถของระบบ หรือข้อผิดพลาดทางเทคนิคที่ไม่คาดคิด
วิธีแก้ไข

ลองทำคำขอใหม่ในภายหลังรอให้ระบบแก้ไขปัญหา และลองเรียกใช้งาน API อีกครั้ง
ตรวจสอบคำขอที่ส่งยืนยันว่าข้อมูลในคำขอถูกต้อง เช่น URL, Header, หรือ Payload
ติดต่อฝ่ายสนับสนุน EasySlipแจ้งรายละเอียดปัญหาให้ทีมสนับสนุนทราบ เช่น Endpoint ที่เรียกใช้ เวลาในการส่งคำขอ และ Response ที่ได้รับ

JavaScript Examples
Verify Bank Slip By Payload
Full documents can be viewed here


const axios = require('axios')

try {
    const { data } = await axios.get('https://developer.easyslip.com/api/v1/verify', {
        params: {
            payload: 'PAYLOAD',
        },
        headers: {
            Authorization: 'Bearer YOUR_ACCESS_TOKEN',
        },
    })

    console.log(data)
} catch (error) {
    console.error('Error', error)
}
Verify Bank Slip By Image
Full documents can be viewed here


const axios = require('axios')
const FormData = require('form-data')
const fs = require('fs')

try {
    const formData = new FormData()
    formData.append('file', fs.createReadStream('IMAGE_PATH'))

    const { data } = await axios.post('https://developer.easyslip.com/api/v1/verify', formData, {
        headers: {
            Authorization: 'Bearer YOUR_ACCESS_TOKEN',
        },
    })

    console.log(data)
} catch (error) {
    console.error('Error', error)
}
Verify Bank Slip By Base64
Full documents can be viewed here


const axios = require('axios')

try {
    const { data } = await axios.post(
        'https://developer.easyslip.com/api/v1/verify',
        {
            image: 'BASE64',
        },
        {
            headers: {
                Authorization: 'Bearer YOUR_ACCESS_TOKEN',
            },
        },
    )

    console.log(data)
} catch (error) {
    console.error('Error', error)
}
Verify Bank Slip By URL
Full documents can be viewed here


const axios = require('axios')

try {
    const { data } = await axios.post(
        'https://developer.easyslip.com/api/v1/verify',
        {
            url: 'URL',
        },
        {
            headers: {
                Authorization: 'Bearer YOUR_ACCESS_TOKEN',
            },
        },
    )

    console.log(data)
} catch (error) {
    console.error('Error', error)
}



