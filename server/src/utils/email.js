import nodemailer from "nodemailer";

// Создаём транспортер для отправки email
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.mail.ru",
  port: Number(process.env.SMTP_PORT || 465),
  secure: process.env.SMTP_PORT === "465" || process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

/**
 * Отправляет уведомление о новом заказе
 * @param {Object} orderData - данные заказа
 * @param {Array} items - массив товаров заказа
 */
export async function sendOrderNotification(orderData, items) {
  const recipientEmail = process.env.ORDER_NOTIFICATION_EMAIL || "zar.alexander00@mail.ru";

  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    console.warn("SMTP credentials not configured, skipping email notification");
    return;
  }

  // Форматируем список товаров (без цен)
  const itemsList = items
    .map(
      (item, idx) =>
        `${idx + 1}. ${item.product_name || `Товар ID: ${item.product_id}`} - ${item.qty} шт.`
    )
    .join("\n");

  // Адрес как строка
  const addressText = orderData.address || "Не указан";

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
    .content { background-color: #f9f9f9; padding: 20px; }
    .section { margin-bottom: 20px; }
    .label { font-weight: bold; color: #555; }
    .value { margin-left: 10px; }
    .items { background-color: white; padding: 15px; border-radius: 5px; margin-top: 10px; }
    .total { font-size: 18px; font-weight: bold; color: #4CAF50; margin-top: 15px; }
    .footer { text-align: center; color: #777; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Новый заказ #${orderData.id}</h1>
    </div>
    <div class="content">
      <div class="section">
        <div><span class="label">ID заказа:</span><span class="value">${orderData.id}</span></div>
        <div><span class="label">Дата создания:</span><span class="value">${new Date(orderData.created_at).toLocaleString("ru-RU")}</span></div>
      </div>
      
      <div class="section">
        <h3>Контактная информация:</h3>
        <div><span class="label">Имя:</span><span class="value">${orderData.customer_name || "Не указано"}</span></div>
        <div><span class="label">Email:</span><span class="value">${orderData.email || "Не указан"}</span></div>
        <div><span class="label">Телефон:</span><span class="value">${orderData.phone || "Не указан"}</span></div>
      </div>

      <div class="section">
        <h3>Адрес доставки:</h3>
        <pre style="background: white; padding: 10px; border-radius: 5px; white-space: pre-wrap;">${addressText}</pre>
      </div>

      <div class="section">
        <h3>Комментарий заказчика:</h3>
        <p>${orderData.comment || "Нет комментария"}</p>
      </div>

      <div class="section">
        <h3>Товары:</h3>
        <div class="items">
          <pre style="margin: 0; white-space: pre-wrap;">${itemsList}</pre>
        </div>
      </div>
    </div>
    <div class="footer">
      <p>Это автоматическое уведомление о новом заказе</p>
    </div>
  </div>
</body>
</html>
  `;

  const emailText = `
Новый заказ #${orderData.id}

Дата создания: ${new Date(orderData.created_at).toLocaleString("ru-RU")}

Контактная информация:
Имя: ${orderData.customer_name || "Не указано"}
Email: ${orderData.email || "Не указан"}
Телефон: ${orderData.phone || "Не указан"}

Адрес доставки:
${addressText}

Комментарий заказчика:
${orderData.comment || "Нет комментария"}

Товары:
${itemsList}
  `;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: recipientEmail,
      subject: `Новый заказ #${orderData.id}`,
      text: emailText,
      html: emailHtml,
    });
    console.log(`Order notification email sent to ${recipientEmail}`);
  } catch (error) {
    console.error("Failed to send order notification email:", error);
    // Не бросаем ошибку, чтобы не ломать создание заказа
  }
}

