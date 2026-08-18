import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Home, Building2, Hotel, Briefcase, ArrowRight, ArrowUpDown } from "lucide-react";
import houseImg from "@/assets/house-category.jpg";
import apartmentImg from "@/assets/apartment-category.jpg";
import hotelImg from "@/assets/hotel-category.jpg";
import commercialImg from "@/assets/commercial-category.jpg";

const categories = [
  {
    type: "villa",
    title: "Villas",
    desc: "Full homes with rooms, kitchens & parking",
    icon: Home,
    image: houseImg,
    pricing: "Monthly rent",
  },
  {
    type: "apartment",
    title: "Apartments",
    desc: "Modern living with balconies & floor options",
    icon: Building2,
    image: apartmentImg,
    pricing: "Monthly rent",
    elevator: true,
  },
  {
    type: "hotel",
    title: "Hotels",
    desc: "Daily stays with full amenities",
    icon: Hotel,
    image: hotelImg,
    pricing: "Daily rate",
    elevator: true,
  },
  {
    type: "commercial",
    title: "Commercial",
    desc: "Offices, shops & business spaces",
    icon: Briefcase,
    image: commercialImg,
    pricing: "Monthly rent",
    elevator: true,
  },
];

const CategorySection = () => {
  const navigate = useNavigate();

  return (
    <section className="py-12 md:py-20">
      <div className="container">
        <div className="mb-8 md:mb-10">
          <span className="text-xs font-bold uppercase tracking-widest text-primary mb-2 block">Explore</span>
          <h2 className="text-2xl md:text-3xl font-heading font-extrabold text-foreground tracking-tight">
            Browse by category
          </h2>
          <p className="text-muted-foreground text-sm md:text-base mt-1.5">
            Villas, apartments, hotels or commercial spaces — find your fit
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
          {categories.map((cat, i) => (
            <motion.div
              key={cat.type}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              onClick={() => navigate(`/properties?type=${cat.type}`)}
              className="group relative overflow-hidden rounded-3xl cursor-pointer aspect-[3/4] shadow-card hover:shadow-elevated transition-shadow duration-300"
            >
              <img
                src={cat.image}
                alt={cat.title}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-foreground/85 via-foreground/25 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="absolute bottom-0 left-0 right-0 p-4 md:p-5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl bg-card/90 backdrop-blur-sm flex items-center justify-center shadow-sm">
                    <cat.icon className="w-4 h-4 md:w-[18px] md:h-[18px] text-primary" />
                  </div>
                  <span className="text-[9px] md:text-[10px] uppercase tracking-widest text-white/70 font-bold">
                    {cat.pricing}
                  </span>
                </div>
                <h3 className="text-base md:text-xl font-heading font-bold text-white mb-0.5 md:mb-1">{cat.title}</h3>
                <p className="text-white/65 text-xs md:text-sm mb-2 md:mb-3 hidden sm:block">{cat.desc}</p>
                <div className="inline-flex items-center gap-1.5 text-xs md:text-sm font-bold text-foreground bg-card/90 backdrop-blur-sm rounded-full px-3 py-1.5 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  Explore <ArrowRight className="w-3.5 h-3.5 md:w-4 md:h-4 group-hover:translate-x-0.5 transition-transform" />
                </div>
                {cat.elevator && (
                  <div className="mt-2 text-[11px] md:text-xs text-white/80 font-medium flex items-center gap-1">
                    {/* An icon, not 🛗 — the emoji renders in each platform's own
                        drawing style and sat visibly apart from the lucide set
                        used everywhere else on the card. */}
                    <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" /> Elevator available
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default CategorySection;
