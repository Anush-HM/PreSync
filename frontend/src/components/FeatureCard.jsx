function FeatureCard({ tagLabel, tagColor, title, description }) {
  return (
    <div className="feature-card">
      <span className={`feature-tag tag-${tagColor}`}>{tagLabel}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export default FeatureCard;