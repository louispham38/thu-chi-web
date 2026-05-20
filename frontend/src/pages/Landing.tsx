import { Link, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "../auth";

export default function Landing() {
  const { user, workspaces, loading } = useAuth();
  const nav = useNavigate();

  // If already logged in with a workspace, jump straight in.
  useEffect(() => {
    if (loading) return;
    if (user && workspaces.length > 0) nav("/app", { replace: true });
  }, [user, workspaces, loading, nav]);

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="brand">
          <span className="logo">⌁</span>
          <strong>Thu / Chi</strong>
        </div>
        <nav>
          {user ? (
            <Link to="/app" className="btn-link">
              Vào ứng dụng →
            </Link>
          ) : (
            <Link to="/login" className="btn-link">
              Đăng nhập
            </Link>
          )}
        </nav>
      </header>

      <section className="hero">
        <div className="hero-inner">
          <h1>
            Quản lý thu chi cá nhân
            <br />
            <span className="accent">đồng bộ thẳng vào Google Sheet</span>
          </h1>
          <p className="hero-sub">
            Đăng nhập bằng Google trong 5 giây — ứng dụng tự tạo một Google Sheet riêng trong Drive của bạn,
            ghi từng giao dịch như một cuốn sổ tay điện tử. Có dashboard, cash flow theo ngày, kế hoạch quỹ
            tích lũy, và share workspace cho gia đình.
          </p>
          <div className="hero-cta">
            {user ? (
              <Link to="/app" className="btn-primary big">
                Mở ứng dụng
              </Link>
            ) : (
              <Link to="/login" className="btn-primary big">
                Bắt đầu — đăng ký bằng Google
              </Link>
            )}
            <span className="hero-note">Miễn phí · Dữ liệu thuộc về bạn</span>
          </div>
        </div>
      </section>

      <section className="features">
        <Feature
          icon="💬"
          title="Nhập như chat Telegram"
          desc="Gõ tự nhiên: 'ăn sáng 50k tiền mặt' — app tự nhận diện số tiền, danh mục, tài khoản."
        />
        <Feature
          icon="📊"
          title="Dashboard & Cash flow"
          desc="Biểu đồ thu/chi theo tháng, theo ngày, theo danh mục. Lọc tuần, tháng, hoặc khoảng tùy chỉnh."
        />
        <Feature
          icon="🏦"
          title="Tài khoản & Số dư"
          desc="Theo dõi số dư đầu kỳ và hiện có cho từng tài khoản (ngân hàng, ví, tiền mặt)."
        />
        <Feature
          icon="🎯"
          title="Kế hoạch quỹ"
          desc="Phân bổ thu nhập vào 7 quỹ: sinh hoạt, tích luỹ, đầu tư, dự phòng, cho đi, hưu, đầu tư tương lai."
        />
        <Feature
          icon="👨‍👩‍👧"
          title="Chia sẻ với gia đình"
          desc="Mời thành viên qua email để cùng quản lý một ví — phân quyền owner/editor/viewer."
        />
        <Feature
          icon="🔒"
          title="Dữ liệu của bạn"
          desc="Sheet nằm trong Google Drive cá nhân, có thể export, share, hoặc gỡ app khỏi tài khoản Google bất cứ lúc nào."
        />
      </section>

      <footer className="landing-footer">
        © {new Date().getFullYear()} Thu/Chi · <a href="https://github.com/louispham38/thu-chi-web">GitHub</a>
      </footer>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="feat-card">
      <div className="feat-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{desc}</p>
    </div>
  );
}
