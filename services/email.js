const nodemailer = require('nodemailer');

let transporter;

async function initTransporter() {
  if (transporter) return transporter;

  // For testing, we use Ethereal Email. In production, use standard SMTP.
  if (!process.env.SMTP_HOST) {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: testAccount.user, // generated ethereal user
        pass: testAccount.pass, // generated ethereal password
      },
    });
    console.log('Test Email Account Created:', testAccount.user);
  } else {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

async function sendOTPEmail(to, code) {
  const t = await initTransporter();
  const info = await t.sendMail({
    from: '"FinTrack App" <noreply@fintrack.app>',
    to: to,
    subject: "Your FinTrack Verification Code",
    text: `Your OTP verification code is: ${code}. It will expire in 10 minutes.`,
    html: `<b>Your OTP verification code is: <span style="font-size:24px; color:#1565C0">${code}</span></b><br>It will expire in 10 minutes.`,
  });

  console.log("Message sent: %s", info.messageId);
  if (!process.env.SMTP_HOST) {
    console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
  }
  return info;
}

module.exports = { sendOTPEmail };
