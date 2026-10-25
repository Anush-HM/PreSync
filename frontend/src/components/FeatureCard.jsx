function FeatureCard({ icon: Icon, title, description }) {
  return (
    <div className="feature-card">
      {Icon && <span className="feature-icon"><Icon aria-hidden="true" /></span>}
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export default FeatureCard;
