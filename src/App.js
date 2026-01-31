import { useState, useEffect } from 'react';
import { db, auth } from './firebase'; 
import { collection, addDoc, onSnapshot, doc, updateDoc, query, where, setDoc, getDoc, arrayUnion } from 'firebase/firestore'; 
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
// Removed Radar Chart imports, kept standard Charts
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell, Legend, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import './index.css';

function App() {
  // --- STATE VARIABLES ---
  const [user, setUser] = useState(null); 
  const [userData, setUserData] = useState(null); 
  const [userMode, setUserMode] = useState("student"); 
  
  const [canteens, setCanteens] = useState([]); 
  const [selectedCanteen, setSelectedCanteen] = useState(null); 
  
  const [cart, setCart] = useState([]); 
  const [orders, setOrders] = useState([]); 
  const [currentView, setCurrentView] = useState("home"); 

  const [isRegistering, setIsRegistering] = useState(false); 
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [collegeId, setCollegeId] = useState("");
  const [confirmPass, setConfirmPass] = useState("");

  // Shopkeeper
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newItemImage, setNewItemImage] = useState("");
  const [menuSearchTerm, setMenuSearchTerm] = useState("");
  
  // Student
  const [searchTerm, setSearchTerm] = useState("");
  const [specialRequest, setSpecialRequest] = useState(""); 
  const [topSellingItems, setTopSellingItems] = useState([]);
  const [waitTime, setWaitTime] = useState(0); 

  const DEFAULT_IMG = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=60";
  const CANTEEN_IMG = "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=1600&q=80"; 

  // --- 1. AUTH & WALLET LISTENER ---
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (u) => {
      if (u) {
        setUser(u);
        if (u.email === "admin@canteen.com") {
          setUserMode("shopkeeper");
        } else {
          setUserMode("student");
          setSelectedCanteen(null);
          setCurrentView("home");
          onSnapshot(doc(db, "users", u.uid), async (snapshot) => {
             if(snapshot.exists()) {
                const data = snapshot.data();
                setUserData(data);
                if (data.walletBalance === undefined) {
                    await updateDoc(doc(db, "users", u.uid), { walletBalance: 5000 });
                }
             }
          });
        }
      } else {
        setUser(null); setUserData(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // --- 2. CANTEEN LISTENER ---
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "canteens"), (snapshot) => {
        setCanteens(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // --- 3. ORDERS LISTENER ---
  useEffect(() => {
    const q = collection(db, "orders"); 
    const unsub = onSnapshot(q, (snapshot) => {
      const allOrders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      
      let myOrders = [];
      if (userMode === "shopkeeper") {
          myOrders = allOrders;
      } else if (user && user.email) {
          myOrders = allOrders.filter(o => o.studentId === user.email);
      }
      myOrders.sort((a,b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      setOrders(myOrders);

      // Trending Logic
      const itemCounts = {};
      allOrders.forEach(o => {
          o.items.forEach(i => { itemCounts[i.name] = (itemCounts[i.name] || 0) + 1; });
      });
      const top3 = Object.entries(itemCounts).sort((a,b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
      setTopSellingItems(top3);

      // Wait Time Logic
      const activeCount = allOrders.filter(o => o.status === 'pending' || o.status === 'preparing').length;
      setWaitTime(activeCount * 5); 
    });
    return () => unsub();
  }, [user, userMode]);

  // --- ACTIONS ---
  const handleLogin = (e) => { 
    e.preventDefault(); 
    signInWithEmailAndPassword(auth, email, password).catch(err => alert(err.message)); 
  };
  
  const handleSignup = async (e) => {
    e.preventDefault();
    if (password !== confirmPass) return alert("Passwords do not match!");
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "users", cred.user.uid), { fullName, collegeId, email, role: "student", walletBalance: 5000 });
      alert("Account Created! You got ₹5000 Signup Bonus!");
    } catch (err) { alert(err.message); }
  };

  const placeOrder = async () => {
    if (cart.length === 0) return alert("Cart empty!");
    if (!userData || userData.walletBalance === undefined) return alert("Loading data...");

    const totalAmount = cart.reduce((a, b) => a + b.price, 0);

    if (userData.walletBalance < totalAmount) {
      return alert(`Insufficient Funds! Total: ₹${totalAmount}, Balance: ₹${userData.walletBalance}`);
    }

    const tokenId = Math.floor(1000 + Math.random() * 9000); 
    const studentLabel = userData.fullName ? `${userData.fullName} (${userData.collegeId})` : user.email;

    try {
      await updateDoc(doc(db, "users", user.uid), { walletBalance: userData.walletBalance - totalAmount });
      await addDoc(collection(db, "orders"), {
        items: cart, 
        total: totalAmount, 
        status: "pending", 
        studentId: user.email, 
        studentName: studentLabel, 
        canteenName: selectedCanteen?.name || "Main Canteen",
        note: specialRequest,
        tokenId: tokenId, 
        timestamp: new Date()
      });
      alert(`Order Placed! Token #${tokenId}`); 
      setCart([]); 
      setSpecialRequest("");
      setCurrentView("account"); 
      setSelectedCanteen(null);
    } catch (err) { console.error(err); alert("Transaction Failed: " + err.message); }
  };

  const addNewItem = async (e) => {
    e.preventDefault();
    if (!newItemName.trim() || !newItemPrice) return alert("Error: Item Name and Price are mandatory!");
    try {
      const canteenRef = doc(db, "canteens", canteens[0].id);
      await updateDoc(canteenRef, {
        menu: arrayUnion({ name: newItemName, price: Number(newItemPrice), image: newItemImage || DEFAULT_IMG, available: true })
      });
      alert("Item Added!");
      setNewItemName(""); setNewItemPrice(""); setShowAddForm(false);
    } catch (error) { alert(error.message); }
  };

  const toggleShopStatus = async () => {
    if (canteens.length === 0) return;
    const canteen = canteens[0];
    try { await updateDoc(doc(db, "canteens", canteen.id), { isOpen: !(canteen.isOpen !== false) }); } catch (err) { alert(err.message); }
  };

  const toggleItemAvailability = async (itemToToggle) => {
      const canteen = canteens[0];
      const updatedMenu = canteen.menu.map(item => {
          if (item.name === itemToToggle.name) return { ...item, available: !(item.available !== false) };
          return item;
      });
      await updateDoc(doc(db, "canteens", canteen.id), { menu: updatedMenu });
  };

  const updateStatus = async (id, st) => {
      const data = { status: st };
      if (st === "ready") data.completedAt = new Date();
      await updateDoc(doc(db, "orders", id), data);
  };
  
  const handleLogout = () => { signOut(auth); setCart([]); setSelectedCanteen(null); };
  const goHome = () => { setCurrentView("home"); setSelectedCanteen(null); };

  // --- ANALYTICS ENGINE ---
  const processStats = () => {
    const dailyData = {}; const itemCounts = {}; const canteenSpending = {}; const dailyItemBreakdown = {}; const hourlyTraffic = {}; const customerSpending = {};
    const categoryData = { "Fast Food": 0, "Meals": 0, "Drinks": 0, "Snacks": 0 };
    const mealTimeData = { "Breakfast": 0, "Lunch": 0, "Dinner": 0, "Late Night": 0 };
    let totalSpent = 0; let totalWaitMins = 0; let completedOrdersCount = 0; let rejectedCount = 0;

    orders.forEach(o => {
      const date = o.timestamp?.toDate().toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) || "Today";
      const hour = o.timestamp?.toDate().getHours() || 0;
      if (!dailyData[date]) dailyData[date] = 0; dailyData[date] += o.total; totalSpent += o.total;
      
      if (userMode === "shopkeeper") {
          const custName = o.studentName || "Unknown"; if (!customerSpending[custName]) customerSpending[custName] = 0; customerSpending[custName] += o.total;
          if (o.status === "ready" && o.completedAt && o.timestamp) { totalWaitMins += (o.completedAt.toDate() - o.timestamp.toDate()) / 60000; completedOrdersCount++; }
          if (o.status === "rejected") rejectedCount++;
      }
      if (userMode === "student") {
          if (hour >= 6 && hour < 11) mealTimeData["Breakfast"] += 1; else if (hour >= 11 && hour < 16) mealTimeData["Lunch"] += 1; else if (hour >= 16 && hour < 22) mealTimeData["Dinner"] += 1; else mealTimeData["Late Night"] += 1;
          o.items.forEach(i => { const n = i.name.toLowerCase(); if (n.includes("burger")||n.includes("pizza")||n.includes("sandwich")||n.includes("roll")||n.includes("momo")) categoryData["Fast Food"] += 1; else if (n.includes("rice")||n.includes("thali")||n.includes("paratha")||n.includes("roti")) categoryData["Meals"] += 1; else if (n.includes("tea")||n.includes("coffee")||n.includes("shake")||n.includes("milk")) categoryData["Drinks"] += 1; else categoryData["Snacks"] += 1; });
      }
      const cName = o.canteenName || "Main Canteen"; if (!canteenSpending[cName]) canteenSpending[cName] = 0; canteenSpending[cName] += o.total;
      const hourLabel = hour > 12 ? `${hour - 12} PM` : `${hour} AM`; if (!hourlyTraffic[hourLabel]) hourlyTraffic[hourLabel] = 0; hourlyTraffic[hourLabel] += 1;
      if(!dailyItemBreakdown[date]) dailyItemBreakdown[date] = { name: date };
      o.items.forEach(item => { if (!itemCounts[item.name]) itemCounts[item.name] = 0; itemCounts[item.name] += 1; if (!dailyItemBreakdown[date][item.name]) dailyItemBreakdown[date][item.name] = 0; dailyItemBreakdown[date][item.name] += 1; });
    });

    const chartData = Object.keys(dailyData).map(date => ({ name: date, amount: dailyData[date] })).slice(-7);
    
    // UPDATED: Simple Bar Data for Cravings
    const cravingsBarData = Object.keys(categoryData).map(key => ({ name: key, count: categoryData[key] }));

    const mealData = Object.keys(mealTimeData).map(key => ({ name: key, orders: mealTimeData[key] }));
    const loyaltyData = Object.keys(customerSpending).map(key => ({ name: key, total: customerSpending[key] })).sort((a,b) => b.total - a.total).slice(0, 3);
    const canteenData = Object.keys(canteenSpending).map(name => ({ name: name, value: canteenSpending[name] }));
    const topItems = Object.keys(itemCounts).map(name => ({ name: name, value: itemCounts[name] })).sort((a,b) => b.value - a.value).slice(0, 5);
    const topItemNames = topItems.map(i => i.name);
    const stackData = Object.values(dailyItemBreakdown).slice(-7);
    const peakHourData = Object.keys(hourlyTraffic).map(h => ({ name: h, value: hourlyTraffic[h] }));
    const avgOrderValue = orders.length > 0 ? (totalSpent / orders.length).toFixed(0) : 0;
    const avgWaitTime = completedOrdersCount > 0 ? (totalWaitMins / completedOrdersCount).toFixed(0) : 0;
    return { totalSpent, chartData, topItems, canteenData, stackData, topItemNames, avgOrderValue, peakHourData, cravingsBarData, mealData, loyaltyData, avgWaitTime, rejectedCount };
  };

  // --- VIEWS ---
  const StatsView = () => {
    const { totalSpent, chartData, topItems, canteenData, stackData, topItemNames, avgOrderValue, peakHourData, cravingsBarData, mealData, loyaltyData, avgWaitTime, rejectedCount } = processStats();
    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF5733'];

    return (
      <div className="container fade-in">
        <div className="hero"><h1>{userMode === "shopkeeper" ? "Business Intelligence" : "Consumption Analytics"}</h1></div>
        <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "20px", marginBottom: "40px"}}>
          <div className="stat-card" style={{background: "var(--bg-card)", padding: "20px", borderRadius: "12px", border: "1px solid var(--border)"}}><h4 style={{margin: 0, color: "#888"}}>TOTAL {userMode==="shopkeeper"?"REVENUE":"SPENT"}</h4><h1 style={{margin: "10px 0", color: "#10b981", fontSize: "32px"}}>₹{totalSpent}</h1></div>
          <div className="stat-card" style={{background: "var(--bg-card)", padding: "20px", borderRadius: "12px", border: "1px solid var(--border)"}}><h4 style={{margin: 0, color: "#888"}}>AVG ORDER VALUE</h4><h1 style={{margin: "10px 0", color: "#3b82f6", fontSize: "32px"}}>₹{avgOrderValue}</h1></div>
          {userMode === "shopkeeper" && <><div className="stat-card" style={{background: "var(--bg-card)", padding: "20px", borderRadius: "12px", border: "1px solid var(--border)"}}><h4 style={{margin: 0, color: "#888"}}>AVG PREP TIME</h4><h1 style={{margin: "10px 0", color: "#f59e0b", fontSize: "32px"}}>{avgWaitTime} <span style={{fontSize: "16px"}}>min</span></h1></div><div className="stat-card" style={{background: "var(--bg-card)", padding: "20px", borderRadius: "12px", border: "1px solid var(--border)"}}><h4 style={{margin: 0, color: "#888"}}>REJECTIONS</h4><h1 style={{margin: "10px 0", color: "#ef4444", fontSize: "32px"}}>{rejectedCount}</h1></div></>}
        </div>
        <div className="main-grid" style={{gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "20px"}}>
          <div style={{background: "var(--bg-card)", padding: "20px", borderRadius: "12px", border: "1px solid var(--border)", minHeight: "350px"}}>
             <h3 style={{color: "white", marginTop: 0}}>Daily Financial Trend</h3>
             <ResponsiveContainer width="100%" height={300}><AreaChart data={chartData}><defs><linearGradient id="colorSplit" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="name" stroke="#666" /><YAxis stroke="#666" /><CartesianGrid strokeDasharray="3 3" stroke="#333" /><Tooltip contentStyle={{backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px'}} /><Area type="monotone" dataKey="amount" stroke="#3b82f6" fillOpacity={1} fill="url(#colorSplit)" /></AreaChart></ResponsiveContainer>
          </div>
          
          {/* STUDENT SECTION */}
          {userMode === "student" && (
            <>
             {/* SIMPLIFIED CRAVINGS GRAPH (Bar Chart instead of Radar) */}
             <div style={{background: "var(--bg-card)", padding: "20px", borderRadius: "12px", border: "1px solid var(--border)", minHeight: "350px"}}>
               <h3 style={{color: "white", marginTop: 0}}>What You Eat Most</h3>
               <ResponsiveContainer width="100%" height={300}>
                 <BarChart data={cravingsBarData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis type="number" stroke="#666" />
                    <YAxis dataKey="name" type="category" width={80} stroke="#fff" />
                    <Tooltip contentStyle={{backgroundColor: '#111', border: '1px solid #333'}} />
                    <Bar dataKey="count" fill="#10b981" barSize={30} radius={[0, 10, 10, 0]} />
                 </BarChart>
               </ResponsiveContainer>
             </div>

             <div style={{background: "var(--bg-card)", padding: "20px", borderRadius: "12px", border: "1px solid var(--border)", minHeight: "350px"}}><h3 style={{color: "white", marginTop: 0}}>Spending by Canteen</h3><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={canteenData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value" label={{ fill: 'white', fontSize: 12 }}>{canteenData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip contentStyle={{backgroundColor: '#111', border: '1px solid #333'}} /><Legend /></PieChart></ResponsiveContainer></div>
            </>
          )}

          {/* SHOPKEEPER SECTION */}
          {userMode === "shopkeeper" && <><div style={{background: "var(--bg-card)", padding: "20px", borderRadius: "12px", border: "1px solid var(--border)", minHeight: "350px"}}><h3 style={{color: "white", marginTop: 0}}>Peak Traffic Hours</h3><ResponsiveContainer width="100%" height={300}><BarChart data={peakHourData}><CartesianGrid strokeDasharray="3 3" stroke="#333" /><XAxis dataKey="name" stroke="#666" /><YAxis stroke="#666" /><Tooltip contentStyle={{backgroundColor: '#111', border: '1px solid #333'}} /><Bar dataKey="value" fill="#FF8042" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div><div style={{background: "var(--bg-card)", padding: "20px", borderRadius: "12px", border: "1px solid var(--border)", minHeight: "350px"}}><h3 style={{color: "white", marginTop: 0}}>Item Sales Breakdown</h3><ResponsiveContainer width="100%" height={300}><BarChart data={stackData}><CartesianGrid strokeDasharray="3 3" stroke="#333" /><XAxis dataKey="name" stroke="#666" /><YAxis stroke="#666" /><Tooltip contentStyle={{backgroundColor: '#111', border: '1px solid #333'}} /><Legend />{topItemNames.map((itemName, index) => (<Bar key={index} dataKey={itemName} stackId="a" fill={COLORS[index % COLORS.length]} />))}</BarChart></ResponsiveContainer></div></>}
        </div>
      </div>
    );
  };

  const AccountView = () => (
    <div className="container fade-in">
      <div className="hero"><h1>History</h1></div>
      {orders.length === 0 ? <p style={{color: "#888"}}>No past orders.</p> : (
        <div style={{display: "grid", gap: "20px"}}>
          {orders.map(o => (
            <div key={o.id} style={{background: "var(--bg-card)", padding: "25px", border: "1px solid var(--border)", borderRadius: "12px", position: "relative", overflow: "hidden"}}>
              <div style={{position: "absolute", top: "-10px", right: "20px", fontSize: "80px", fontWeight: "900", color: "rgba(255,255,255,0.05)", pointerEvents: "none"}}>#{o.tokenId}</div>
              <div style={{display: "flex", justifyContent: "space-between", marginBottom: "15px", position: "relative"}}>
                <div><strong style={{color: "white", display:"block", fontSize: "18px"}}>Token #{o.tokenId}</strong><span style={{color: "#888", fontSize: "14px"}}>{o.canteenName} • {o.timestamp?.toDate().toLocaleDateString()}</span></div>
                <span className={`status-badge status-${o.status}`}>{o.status}</span>
              </div>
              <ul style={{margin: "0 0 15px 0", paddingLeft: "20px", color: "#aaa", position: "relative"}}>{o.items.map((i,x) => <li key={x}>{i.name}</li>)}</ul>
              <div style={{fontWeight: "800", textAlign: "right", fontSize: "18px", color: "white", position: "relative"}}>₹{o.total}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (!user) {
    return (
      <div style={{minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center", background: "var(--bg-body)"}}>
        <div style={{background: "var(--bg-card)", padding: "40px", width: "100%", maxWidth: "350px", border: "1px solid var(--border)", borderRadius: "16px"}}>
          <h2 style={{marginTop: 0, marginBottom: "20px", color: "white"}}>{isRegistering ? "Create Account" : "Sign In"}</h2>
          <form onSubmit={isRegistering ? handleSignup : handleLogin}>
            {isRegistering && <><input type="text" placeholder="Full Name" onChange={e=>setFullName(e.target.value)} required /><input type="text" placeholder="College ID" onChange={e=>setCollegeId(e.target.value)} required /></>}
            <input type="email" placeholder="Email" onChange={e=>setEmail(e.target.value)} required />
            <input type="password" placeholder="Password" onChange={e=>setPassword(e.target.value)} required />
            {isRegistering && <input type="password" placeholder="Confirm Password" onChange={e=>setConfirmPass(e.target.value)} required />}
            <button type="submit" className="btn btn-primary" style={{width: "100%", marginTop: "10px"}}>{isRegistering ? "Join (Get ₹5000)" : "Enter"}</button>
          </form>
          <button onClick={()=>setIsRegistering(!isRegistering)} className="btn btn-secondary" style={{width: "100%", marginTop: "10px"}}>{isRegistering ? "Back to Login" : "No account? Register"}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{minHeight: "100vh", paddingBottom: "100px"}}> 
      <div className="navbar">
        <div className="logo" onClick={goHome} style={{cursor:"pointer"}}>CAMTEEN.</div>
        <div style={{display: "flex", alignItems: "center", gap: "15px"}}>
          {userMode === "student" && userData && <div style={{color: "#10b981", fontWeight: "bold", border: "1px solid #10b981", padding: "8px 15px", borderRadius: "20px", fontSize: "14px"}}>₹{userData.walletBalance}</div>}
          <div style={{display: "flex", gap: "10px"}}>
            <button onClick={goHome} className={`btn ${currentView==="home"?"btn-primary":"btn-secondary"}`}>Menu</button>
            {userMode === "student" && <button onClick={()=>setCurrentView("account")} className={`btn ${currentView==="account"?"btn-primary":"btn-secondary"}`}>History</button>}
            <button onClick={()=>setCurrentView("stats")} className={`btn ${currentView==="stats"?"btn-primary":"btn-secondary"}`}>Stats</button>
            <button onClick={handleLogout} className="btn btn-danger" style={{border: "none"}}>Exit</button>
          </div>
        </div>
      </div>
      {currentView === "stats" && <StatsView />}
      {currentView === "account" && <AccountView />}
      {currentView === "home" && (
        <div className="container fade-in">
          {userMode === "student" && (
            <>
              {!selectedCanteen ? (
                <>
                  <div className="hero"><h1>Select Canteen</h1><p>Where are you eating today?</p></div>
                  <div className="menu-grid">
                    {canteens.map(c => {
                      const isShopOpen = c.isOpen !== false;
                      return (
                        <div key={c.id} className="food-card" onClick={() => isShopOpen ? setSelectedCanteen(c) : alert("Shop is Closed!")} style={{cursor: isShopOpen ? "pointer" : "not-allowed", alignItems: "flex-start", textAlign: "left", backgroundImage: `linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.7)), url(${CANTEEN_IMG})`, backgroundSize: "cover", border: "1px solid #333", opacity: isShopOpen ? 1 : 0.6 }}>
                          <div style={{marginTop: "auto"}}>
                            <span style={{background: isShopOpen ? "#10b981" : "#ef4444", color: "white", padding: "5px 10px", borderRadius: "4px", fontSize: "12px", fontWeight: "bold", marginBottom: "10px", display: "inline-block"}}>{isShopOpen ? "● OPEN" : "● CLOSED"}</span>
                            <h2 style={{margin: "5px 0", color: "white", fontSize: "24px"}}>{c.name}</h2>
                            <p style={{color: "#ccc", margin: 0, fontSize: "14px"}}>{isShopOpen ? "Click to view menu →" : "Currently Unavailable"}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div style={{position: "relative", width: "100%", height: "300px", backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.9)), url(${CANTEEN_IMG})`, backgroundSize: "cover", backgroundPosition: "center", borderRadius: "16px", marginBottom: "40px", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "40px"}}>
                    <button onClick={() => setSelectedCanteen(null)} style={{position: "absolute", top: "20px", left: "20px", background: "rgba(0,0,0,0.5)", color: "white", border: "1px solid rgba(255,255,255,0.2)", padding: "8px 16px", borderRadius: "30px", cursor: "pointer", backdropFilter: "blur(5px)"}}>← Back</button>
                    <h1 style={{fontSize: "48px", margin: 0, color: "white"}}>{selectedCanteen.name}</h1>
                    <p style={{color: "#ccc", fontSize: "18px", marginTop: "5px"}}>Full Menu & Beverages</p>
                    <div style={{marginTop: "20px", background: "rgba(0,0,0,0.6)", padding: "10px 20px", borderRadius: "30px", border: "1px solid #f59e0b", color: "#f59e0b", fontWeight: "bold", display: "inline-block", backdropFilter: "blur(5px)"}}>⏳ Current Wait Time: ~{waitTime} mins</div>
                  </div>
                  <div className="main-grid">
                    <div>
                      <input type="text" placeholder="Search for food..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ marginBottom: "30px", background: "transparent", border: "none", borderBottom: "1px solid #333", borderRadius: 0, paddingLeft: 0, fontSize: "20px" }} />
                      <div className="menu-grid">
                        {selectedCanteen.menu && selectedCanteen.menu.filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase())).sort((a, b) => { const aTrend = topSellingItems.includes(a.name); const bTrend = topSellingItems.includes(b.name); if (aTrend && !bTrend) return -1; if (!aTrend && bTrend) return 1; return 0; }).map((item, idx) => {
                            const isAvailable = item.available !== false;
                            const isTrending = topSellingItems.includes(item.name);
                            return (
                              <div key={idx} className="food-card" style={{opacity: isAvailable ? 1 : 0.5, border: isTrending ? "1px solid #FFBB28" : "1px solid #333", position: "relative"}}>
                                {isTrending && <div style={{position: "absolute", top: "-10px", right: "-10px", background: "#FFBB28", color: "black", padding: "5px 10px", borderRadius: "20px", fontWeight: "bold", fontSize: "12px", boxShadow: "0 5px 15px rgba(255,187,40,0.4)"}}>🔥 Trending</div>}
                                <div style={{flex: 1, display: "flex", alignItems: "center", justifyContent: "center"}}><h3>{item.name}</h3></div>
                                <div style={{width: "100%"}}><span className="price-tag">₹{item.price}</span><button disabled={!isAvailable} onClick={() => setCart([...cart, item])} className="btn btn-primary" style={{width: "100%", background: isAvailable ? "var(--primary)" : "#555", cursor: isAvailable ? "pointer" : "not-allowed"}}>{isAvailable ? "Add to Cart" : "Sold Out"}</button></div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                    <div className="cart-panel">
                      <h3 style={{marginTop: 0, color: "white"}}>Your Order</h3>
                      {cart.length === 0 ? <p style={{color: "#555"}}>Cart is empty</p> : (
                        <>
                          <ul style={{paddingLeft: "20px", marginBottom: "20px", color: "#ccc"}}>{cart.map((i, idx) => <li key={idx} style={{marginBottom: "5px"}}>{i.name} <span style={{color:"#555"}}>- ₹{i.price}</span></li>)}</ul>
                          <div style={{borderTop: "1px solid #333", paddingTop: "15px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px"}}><strong style={{color: "white"}}>Total</strong><strong style={{fontSize: "24px", color: "var(--accent)"}}>₹{cart.reduce((a,b)=>a+b.price,0)}</strong></div>
                          <div style={{fontSize: "12px", color: "#666", marginBottom: "10px", textAlign: "right"}}>Wallet: ₹{userData?.walletBalance}</div>
                          <textarea placeholder="Any special requests? (e.g. No onion, Extra spicy)" value={specialRequest} onChange={(e) => setSpecialRequest(e.target.value)} style={{width: "100%", padding: "10px", borderRadius: "6px", background: "#111", border: "1px solid #333", color: "white", marginBottom: "15px", fontFamily: "inherit"}} rows={3} />
                          <button onClick={placeOrder} className="btn btn-primary" style={{width: "100%"}}>Confirm Order</button>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {userMode === "shopkeeper" && (
            <>
              <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "40px", borderBottom: "1px solid #333", paddingBottom: "20px"}}>
                <h1 style={{margin:0, color: "white"}}>Live Orders</h1>
                <div style={{display: "flex", gap: "30px"}}>
                   <button onClick={toggleShopStatus} className={`btn ${canteens[0]?.isOpen !== false ? "btn-danger" : "btn-primary"}`} style={{minWidth: "120px"}}>{canteens[0]?.isOpen !== false ? "🔴 Close Shop" : "🟢 Open Shop"}</button>
                   <button onClick={() => setShowAddForm(!showAddForm)} className="btn btn-primary">{showAddForm ? "Close" : "Manage Menu"}</button>
                </div>
              </div>
              
              {showAddForm && (
                <div style={{background: "var(--bg-card)", padding: "30px", border: "1px solid var(--border)", marginBottom: "40px", borderRadius: "12px"}}>
                  <h3 style={{color: "white", borderBottom: "1px solid #333", paddingBottom: "15px"}}>Manage Menu & Stock</h3>
                  
                  <div style={{marginBottom: "30px"}}>
                     <h4 style={{color: "#888", marginBottom: "10px"}}>Quick Stock Toggle (Click to Mark Sold Out)</h4>
                     <input type="text" placeholder="Search item to toggle..." value={menuSearchTerm} onChange={(e) => setMenuSearchTerm(e.target.value)} style={{marginBottom: "15px", padding: "10px", width: "100%", background: "#111", border: "1px solid #333", color: "white", borderRadius: "6px"}}/>
                     <div style={{display: "flex", flexWrap: "wrap", gap: "10px", maxHeight: "200px", overflowY: "auto"}}>
                        {canteens[0]?.menu?.filter(i => i.name.toLowerCase().includes(menuSearchTerm.toLowerCase())).map((item, idx) => {
                            const isAvailable = item.available !== false;
                            return (
                                <button key={idx} onClick={() => toggleItemAvailability(item)} style={{padding: "8px 12px", borderRadius: "20px", border: isAvailable ? "1px solid #10b981" : "1px solid #555", background: isAvailable ? "rgba(16, 185, 129, 0.1)" : "rgba(255,255,255,0.05)", color: isAvailable ? "#10b981" : "#888", cursor: "pointer", fontSize: "13px"}}>
                                    {isAvailable ? "🟢" : "⚫"} {item.name}
                                </button>
                            );
                        })}
                     </div>
                  </div>

                  <h4 style={{color: "#888", marginTop: "20px"}}>Add New Item to Menu</h4>
                  <form onSubmit={addNewItem} style={{display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "15px", alignItems: "end"}}>
                    <div><label style={{color: "#888", fontSize: "12px"}}>Item Name *</label><input required placeholder="e.g. Cheese Burger" value={newItemName} onChange={e=>setNewItemName(e.target.value)} style={{marginBottom:0}} /></div>
                    <div><label style={{color: "#888", fontSize: "12px"}}>Price (₹) *</label><input required placeholder="e.g. 50" type="number" value={newItemPrice} onChange={e=>setNewItemPrice(e.target.value)} style={{marginBottom:0}} /></div>
                    <button type="submit" className="btn btn-primary" style={{height: "46px"}}>+ Add Item</button>
                  </form>
                </div>
              )}

              <h2 style={{color: "white", marginBottom: "20px"}}>Incoming Orders</h2>
              <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "30px"}}>
                {orders.length === 0 && <p style={{color: "#666"}}>No active orders right now.</p>}
                {orders.map(o => (
                  <div key={o.id} style={{background: "var(--bg-card)", padding: "25px", border: "1px solid var(--border)", borderRadius: "12px", position: "relative", display: "flex", flexDirection: "column", height: "100%", boxShadow: "0 10px 30px rgba(0,0,0,0.3)"}}>
                    <div style={{display: "flex", justifyContent: "space-between", marginBottom: "15px"}}>
                       <div><strong style={{color: "white", fontSize: "20px", display: "block"}}>#{o.tokenId}</strong><span style={{color: "#888", fontSize: "14px"}}>{o.studentName}</span></div>
                       <span className={`status-badge status-${o.status}`}>{o.status}</span>
                    </div>
                    <ul style={{color: "#aaa", flex: 1, margin: "0 0 10px 0"}}>{o.items.map((i,x)=><li key={x}>{i.name}</li>)}</ul>
                    {o.note && <div style={{background: "#FEF3C7", color: "#B45309", padding: "8px", borderRadius: "6px", fontSize: "12px", marginBottom: "15px", fontWeight: "bold"}}>📝 Note: {o.note}</div>}
                    <div style={{marginTop: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px"}}>
                      {o.status === "pending" && <><button onClick={() => updateStatus(o.id, "preparing")} className="btn btn-primary">Accept</button><button onClick={() => updateStatus(o.id, "rejected")} className="btn btn-danger">Reject</button></>}
                      {o.status === "preparing" && <button onClick={() => updateStatus(o.id, "ready")} className="btn btn-primary" style={{gridColumn: "span 2"}}>Mark Ready</button>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {userMode === "student" && cart.length > 0 && selectedCanteen && (
            <div style={{position: "fixed", bottom: "30px", left: "50%", transform: "translateX(-50%)", width: "90%", maxWidth: "400px", background: "var(--primary)", color: "white", borderRadius: "50px", padding: "15px 30px", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 10px 40px rgba(59, 130, 246, 0.5)", zIndex: 1000}}>
              <span style={{fontWeight: "600"}}>{cart.length} Items • ₹{cart.reduce((a, b) => a + b.price, 0)}</span>
              <button onClick={placeOrder} style={{background: "white", color: "var(--primary)", border: "none", padding: "8px 20px", borderRadius: "30px", fontWeight: "bold", cursor: "pointer"}}>Pay</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;